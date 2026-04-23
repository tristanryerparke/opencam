#!/usr/bin/env python3
"""
Milling simulation using swept volumes instead of interpolated tool positions.

For each consecutive pair of toolpath positions, the exact swept volume of the
cylindrical cutter under pure translation is computed via tetrahedral
decomposition and convex-hull assembly.  Each swept volume is then subtracted
from the stock in one boolean operation, eliminating the need for dense
position interpolation.

Requirements:
    pip install numpy manifold3d scipy trimesh numba
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path

import numpy as np

from mesh_reduction import simplify_mesh_data

try:
    from manifold3d import Error, Manifold, Mesh64
except ImportError as exc:  # pragma: no cover
    raise SystemExit(
        "manifold3d is required. Install with `uv add manifold3d` or `pip install manifold3d`."
    ) from exc

ROOT = Path(__file__).resolve().parent

STOCK_STL_PATH = ROOT / "assets" / "2.5D_Part.stl"
TOOLPATH_JSON_PATH = ROOT / "paths-rounded-pocket.json"
DEFAULT_OUTPUT_PATH = Path("/tmp/milling-simulation-swept.off")
DEFAULT_OUTPUT_DIR = ROOT / "output"

TOOL_DIAMETER = 12.7
TOOL_HEIGHT = 30.0
TOOL_SEGMENTS = 32
DEFAULT_PLANAR_QEM_MAX_ITERATIONS = 500


# ---------------------------------------------------------------------------
# Argument parsing
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Milling simulation using swept volumes between toolpath positions.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=DEFAULT_OUTPUT_PATH,
        help=f"Output OFF path (default: {DEFAULT_OUTPUT_PATH})",
    )
    parser.add_argument(
        "--max-steps",
        type=int,
        default=None,
        help="Limit how many swept-volume segments are applied.",
    )
    return parser.parse_args()


# ---------------------------------------------------------------------------
# Stock / tool mesh builders
# ---------------------------------------------------------------------------

def load_binary_stl_bounds(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with path.open("rb") as handle:
        _header = handle.read(80)
        triangle_count_bytes = handle.read(4)
        if len(triangle_count_bytes) != 4:
            raise ValueError(f"{path} is not a binary STL file.")
        triangle_count = struct.unpack("<I", triangle_count_bytes)[0]
        payload = handle.read()

    expected = triangle_count * 50
    if len(payload) != expected:
        raise ValueError(f"{path} does not look like a binary STL file.")

    min_c = np.array([math.inf, math.inf, math.inf], dtype=np.float64)
    max_c = np.array([-math.inf, -math.inf, -math.inf], dtype=np.float64)

    for record in struct.iter_unpack("<12fH", payload):
        for x, y, z in (
            (record[3], record[4], record[5]),
            (record[6], record[7], record[8]),
            (record[9], record[10], record[11]),
        ):
            if x < min_c[0]: min_c[0] = x
            if y < min_c[1]: min_c[1] = y
            if z < min_c[2]: min_c[2] = z
            if x > max_c[0]: max_c[0] = x
            if y > max_c[1]: max_c[1] = y
            if z > max_c[2]: max_c[2] = z

    return min_c, max_c


def ensure_triangle_faces(faces: np.ndarray) -> np.ndarray:
    face_array = np.asarray(faces, dtype=np.int32)
    if face_array.ndim != 2 or face_array.shape[1] != 3:
        raise ValueError(f"Expected (m, 3) face array, got {face_array.shape}.")
    return face_array


def build_box_mesh(bounds_min: np.ndarray, bounds_max: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    xmin, ymin, zmin = bounds_min.astype(np.float64)
    xmax, ymax, zmax = bounds_max.astype(np.float64)
    vertices = np.array(
        [
            [xmin, ymin, zmin], [xmax, ymin, zmin],
            [xmax, ymax, zmin], [xmin, ymax, zmin],
            [xmin, ymin, zmax], [xmax, ymin, zmax],
            [xmax, ymax, zmax], [xmin, ymax, zmax],
        ],
        dtype=np.float64,
    )
    faces = np.array(
        [
            [0, 2, 1], [0, 3, 2],
            [4, 5, 6], [4, 6, 7],
            [0, 1, 5], [0, 5, 4],
            [1, 2, 6], [1, 6, 5],
            [2, 3, 7], [2, 7, 6],
            [3, 0, 4], [3, 4, 7],
        ],
        dtype=np.int32,
    )
    return vertices, faces


def build_cylinder_mesh(
    diameter: float,
    height: float,
    segments: int,
) -> tuple[np.ndarray, np.ndarray]:
    """Cylinder with base centred at origin, extending upward in +Z."""
    radius = diameter / 2.0
    angles = np.linspace(0.0, math.tau, segments, endpoint=False, dtype=np.float64)

    bottom_ring = np.column_stack([
        radius * np.cos(angles),
        radius * np.sin(angles),
        np.zeros(segments, dtype=np.float64),
    ])
    top_ring = bottom_ring.copy()
    top_ring[:, 2] = height

    vertices = np.vstack([
        np.array([[0.0, 0.0, 0.0]], dtype=np.float64),
        np.array([[0.0, 0.0, height]], dtype=np.float64),
        bottom_ring,
        top_ring,
    ])

    bottom_center = 0
    top_center = 1
    bottom_start = 2
    top_start = 2 + segments

    faces: list[list[int]] = []
    for i in range(segments):
        j = (i + 1) % segments
        bi = bottom_start + i
        bj = bottom_start + j
        ti = top_start + i
        tj = top_start + j
        faces.append([bottom_center, bj, bi])  # bottom cap
        faces.append([top_center, ti, tj])      # top cap
        faces.append([bi, bj, tj])              # side
        faces.append([bi, tj, ti])              # side

    return vertices, np.asarray(faces, dtype=np.int32)


# ---------------------------------------------------------------------------
# Toolpath loading (no interpolation — we use original positions directly)
# ---------------------------------------------------------------------------

def load_tool_positions(path: Path) -> list[np.ndarray]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    operations = payload if isinstance(payload, list) else [payload]

    positions: list[np.ndarray] = []
    previous: np.ndarray | None = None

    for operation in operations:
        for toolpath in operation.get("paths", []):
            for location in toolpath.get("locations", []):
                position = np.array(
                    [location["x"], location["y"], location["z"]],
                    dtype=np.float64,
                )
                if previous is not None and np.allclose(position, previous, atol=1e-9, rtol=0.0):
                    continue
                positions.append(position)
                previous = position

    return positions


# ---------------------------------------------------------------------------
# Manifold helpers
# ---------------------------------------------------------------------------

def format_manifold_error(status: Error) -> str:
    return getattr(status, "name", str(status))


def ensure_no_manifold_error(manifold: Manifold, *, context: str) -> Manifold:
    status = manifold.status()
    if status != Error.NoError:
        raise RuntimeError(f"Manifold error during {context}: {format_manifold_error(status)}")
    return manifold


def mesh_to_manifold(vertices: np.ndarray, faces: np.ndarray, *, context: str) -> Manifold:
    mesh = Mesh64(
        np.ascontiguousarray(vertices, dtype=np.float64),
        np.ascontiguousarray(ensure_triangle_faces(faces), dtype=np.uint64),
    )
    return ensure_no_manifold_error(Manifold(mesh), context=context)


def manifold_to_mesh(manifold: Manifold, *, context: str) -> tuple[np.ndarray, np.ndarray]:
    """Extract (vertices, faces) from a Manifold."""
    m = ensure_no_manifold_error(manifold, context=context).to_mesh64()
    verts = np.asarray(m.vert_properties, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(m.tri_verts, dtype=np.int32))
    return verts[:, :3], faces


def to_xyz(v: np.ndarray) -> tuple[float, float, float]:
    a = np.asarray(v, dtype=np.float64).reshape(3)
    return float(a[0]), float(a[1]), float(a[2])


def rotation_matrix_about_z_to_face_xy_direction(direction: np.ndarray) -> np.ndarray:
    """Return a Z-axis rotation that maps the local +X axis onto `direction` in the XY plane."""
    vector = np.asarray(direction, dtype=np.float64).reshape(3)
    xy = vector[:2]
    norm = float(np.linalg.norm(xy))
    if norm < 1e-12:
        return np.eye(3, dtype=np.float64)

    cos_theta = float(xy[0] / norm)
    sin_theta = float(xy[1] / norm)
    return np.array(
        [
            [cos_theta, -sin_theta, 0.0],
            [sin_theta, cos_theta, 0.0],
            [0.0, 0.0, 1.0],
        ],
        dtype=np.float64,
    )


# ---------------------------------------------------------------------------
# Swept-volume computation (manifold3d convex hull)
# ---------------------------------------------------------------------------


def swept_volume_manifold(
    tool_verts: np.ndarray,
    translation: np.ndarray | None = None,
    *,
    end_verts: np.ndarray | None = None,
    context: str,
) -> Manifold:
    """
    Exact swept volume of a convex tool mesh.

    Pass either a translation vector (original behavior) or explicit
    end_verts. The caller is responsible for rotating/positioning the cutter
    before invoking this helper.
    """
    tool_array = np.asarray(tool_verts, dtype=np.float64)
    if tool_array.ndim != 2 or tool_array.shape[1] < 3:
        raise ValueError(
            f"Expected a vertex matrix with at least 3 columns, got {tool_array.shape}."
        )
    start_xyz = tool_array[:, :3]

    if end_verts is not None:
        end_array = np.asarray(end_verts, dtype=np.float64)
        if end_array.ndim != 2 or end_array.shape[1] < 3:
            raise ValueError(
                f"Expected an end-vertex matrix with at least 3 columns, got {end_array.shape}."
            )
        end_xyz = end_array[:, :3]
        if end_xyz.shape != start_xyz.shape:
            raise ValueError(
                f"Start and end vertex arrays must have matching shapes, got {start_xyz.shape} and {end_xyz.shape}."
            )
    else:
        if translation is None:
            raise ValueError("Either translation or end_verts must be provided.")

        second_array = np.asarray(translation, dtype=np.float64)
        if second_array.ndim == 1 and second_array.shape == (3,):
            if np.linalg.norm(second_array) < 1e-12:
                raise ValueError("Zero-length translation should be skipped by caller.")
            end_xyz = start_xyz + second_array[None, :]
        else:
            if second_array.ndim != 2 or second_array.shape[1] < 3:
                raise ValueError(
                    f"Expected a translation vector or end-vertex matrix, got {second_array.shape}."
                )
            end_xyz = second_array[:, :3]
            if end_xyz.shape != start_xyz.shape:
                raise ValueError(
                    f"Start and end vertex arrays must have matching shapes, got {start_xyz.shape} and {end_xyz.shape}."
                )

    all_pts = np.vstack([start_xyz, end_xyz])
    hull_manifold = Manifold.hull_points(np.ascontiguousarray(all_pts, dtype=np.float64))
    return ensure_no_manifold_error(hull_manifold, context=context)


# ---------------------------------------------------------------------------
# Mesh reduction helpers
# ---------------------------------------------------------------------------


def simplify_planar_mesh(
    vertices: np.ndarray,
    faces: np.ndarray,
    *,
    context: str,
) -> tuple[np.ndarray, np.ndarray]:
    """Reduce a mesh using the reusable planar QEM simplifier."""
    vertex_array = np.asarray(vertices, dtype=np.float64)
    if vertex_array.ndim != 2 or vertex_array.shape[1] < 3:
        raise ValueError(f"Expected a vertex matrix with at least 3 columns, got {vertex_array.shape}.")

    face_array = ensure_triangle_faces(faces)
    if len(face_array) == 0:
        return vertex_array[:, :3], face_array

    simplified = simplify_mesh_data(
        vertex_array[:, :3],
        face_array,
        max_iterations=DEFAULT_PLANAR_QEM_MAX_ITERATIONS,
        verbose=False,
    )
    simplified_vertices = np.asarray(simplified.vertices, dtype=np.float64)
    simplified_faces = ensure_triangle_faces(np.asarray(simplified.faces, dtype=np.int32))

    if len(simplified_faces) > len(face_array):
        print(
            f"  Planar reduction at {context} increased face count; keeping original mesh "
            f"({len(vertex_array)} verts, {len(face_array)} faces).",
        )
        return vertex_array[:, :3], face_array

    print(
        f"  Planar reduction at {context}: "
        f"{len(vertex_array)} -> {len(simplified_vertices)} vertices, "
        f"{len(face_array)} -> {len(simplified_faces)} faces",
    )
    return simplified_vertices, simplified_faces


# ---------------------------------------------------------------------------
# Output writers
# ---------------------------------------------------------------------------

def write_off_arrays(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    vertex_array = np.asarray(vertices, dtype=np.float64)
    if vertex_array.ndim != 2 or vertex_array.shape[1] < 3:
        raise ValueError(f"Expected a vertex matrix with at least 3 columns, got {vertex_array.shape}.")

    face_array = ensure_triangle_faces(faces)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        handle.write("OFF\n")
        handle.write(f"{len(vertex_array)} {len(face_array)} 0\n")
        for x, y, z in vertex_array[:, :3]:
            handle.write(f"{x:.10f} {y:.10f} {z:.10f}\n")
        for a, b, c in face_array:
            handle.write(f"3 {int(a)} {int(b)} {int(c)}\n")


def write_stl_arrays(path: Path, vertices: np.ndarray, faces: np.ndarray) -> None:
    vertex_array = np.asarray(vertices, dtype=np.float64)
    if vertex_array.ndim != 2 or vertex_array.shape[1] < 3:
        raise ValueError(f"Expected a vertex matrix with at least 3 columns, got {vertex_array.shape}.")

    face_array = ensure_triangle_faces(faces)
    path.parent.mkdir(parents=True, exist_ok=True)
    header = b"Generated by test_milling_simulation_swept.py"
    with path.open("wb") as handle:
        handle.write(header.ljust(80, b"\0")[:80])
        handle.write(struct.pack("<I", len(face_array)))
        for a, b, c in face_array:
            p0 = vertex_array[int(a), :3]
            p1 = vertex_array[int(b), :3]
            p2 = vertex_array[int(c), :3]
            normal = np.cross(p1 - p0, p2 - p0)
            nlen = float(np.linalg.norm(normal))
            normal = normal / nlen if nlen > 0.0 else np.zeros(3)
            handle.write(struct.pack(
                "<12fH",
                float(normal[0]), float(normal[1]), float(normal[2]),
                float(p0[0]), float(p0[1]), float(p0[2]),
                float(p1[0]), float(p1[1]), float(p1[2]),
                float(p2[0]), float(p2[1]), float(p2[2]),
                0,
            ))


def write_off(path: Path, manifold: Manifold) -> None:
    vertices, faces = manifold_to_mesh(manifold, context=f"writing {path}")
    write_off_arrays(path, vertices, faces)


def write_stl(path: Path, manifold: Manifold) -> None:
    vertices, faces = manifold_to_mesh(manifold, context=f"writing {path}")
    write_stl_arrays(path, vertices, faces)


def launch_meshlab(path: Path) -> None:
    meshlab_path = shutil.which("meshlab")
    if meshlab_path is not None:
        subprocess.run([meshlab_path, str(path)], check=False)
        return
    if sys.platform == "darwin":
        subprocess.run(["open", "-a", "MeshLab", str(path)], check=False)
        return
    print("MeshLab not found on PATH; viewer step skipped.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> int:
    args = parse_args()

    # --- Build stock ---
    stock_min, stock_max = load_binary_stl_bounds(STOCK_STL_PATH)
    stock_verts, stock_faces = build_box_mesh(stock_min, stock_max)
    stock_manifold = mesh_to_manifold(stock_verts, stock_faces, context="stock mesh import")

    # --- Build tool ---
    tool_verts, tool_faces = build_cylinder_mesh(TOOL_DIAMETER, TOOL_HEIGHT, TOOL_SEGMENTS)

    # --- Load toolpath (no interpolation needed!) ---
    positions = load_tool_positions(TOOLPATH_JSON_PATH)
    if args.max_steps is not None:
        positions = positions[: max(args.max_steps, 0)]

    print(f"Stock bounds: min={stock_min.tolist()} max={stock_max.tolist()}")
    print(f"Tool: diameter={TOOL_DIAMETER} height={TOOL_HEIGHT} segments={TOOL_SEGMENTS}")
    print(f"Loaded {len(positions)} toolpath positions")
    print(f"Swept segments to process: {len(positions) - 1}")

    subtraction_seconds = 0.0
    current = stock_manifold

    for step in range(1, len(positions)):
        pos_a = positions[step - 1]
        pos_b = positions[step]
        translation = pos_b - pos_a

        # Skip zero-length segments
        if np.linalg.norm(translation) < 1e-9:
            continue

        # Rotate the cutter around its Z axis so its original +X axis points
        # along the sweep direction in the XY plane, then place both the start
        # and end copies before creating the swept hull.
        sweep_rotation = rotation_matrix_about_z_to_face_xy_direction(translation)
        rotated_tool_verts = tool_verts @ sweep_rotation.T
        start_sweep_verts = rotated_tool_verts + pos_a[None, :]
        end_sweep_verts = rotated_tool_verts + pos_b[None, :]
        swept_manifold = swept_volume_manifold(
            start_sweep_verts,
            end_verts=end_sweep_verts,
            context=f"swept volume for segment {step}",
        )

        # Subtract swept volume from stock
        t0 = time.perf_counter()
        current = ensure_no_manifold_error(
            current - swept_manifold,
            context=f"subtraction at segment {step}",
        )
        subtraction_seconds += time.perf_counter() - t0

        if step == 1 or step % 10 == 0 or step == len(positions) - 1:
            print(
                f"  segment {step}/{len(positions) - 1}  "
                f"translation=({translation[0]:.2f}, {translation[1]:.2f}, {translation[2]:.2f})  "
                f"-> {current.num_vert()} vertices, {current.num_tri()} faces",
            )

    # Remove disconnected fragments (tiny slivers that separate during cutting)
    components = current.decompose()
    if len(components) > 1:
        largest = max(components, key=lambda m: m.num_tri())
        removed = sum(m.num_tri() for m in components if m is not largest)
        print(f"\nRemoved {len(components) - 1} disconnected fragment(s) "
              f"({removed} stray face(s), kept {largest.num_tri()}-face main body)")
        current = largest

    final_vertices, final_faces = manifold_to_mesh(current, context="extracting final swept stock mesh")
    final_vertices, final_faces = simplify_planar_mesh(
        final_vertices,
        final_faces,
        context="final swept stock mesh",
    )

    stl_output_path = DEFAULT_OUTPUT_DIR / f"{args.output.stem}.stl"
    write_off_arrays(args.output, final_vertices, final_faces)
    write_stl_arrays(stl_output_path, final_vertices, final_faces)
    print(f"\nSubtraction took {subtraction_seconds:.3f} seconds")
    print(f"Wrote {args.output}")
    print(f"Wrote {stl_output_path}")

    launch_meshlab(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
