#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
import struct
import subprocess
import sys
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from manifold3d import Error, Manifold, Mesh64

from mesh_reduction import QEMProfile, format_qem_profile, simplify_mesh_data


ROOT = Path(__file__).resolve().parent

STOCK_STL_PATH = ROOT / "assets" / "2.5D_Part.stl"
TOOLPATH_JSON_PATH = ROOT / "paths-rounded-pocket.json"
DEFAULT_OUTPUT_PATH = Path("/tmp/milling-simulation-manifold.off")
DEFAULT_OUTPUT_DIR = ROOT / "output"

TOOL_DIAMETER = 12.7
TOOL_HEIGHT = 30.0
TOOL_SEGMENTS = 16
DEFAULT_INTERPOLATION_DISTANCE = 0.5
DEFAULT_SIMPLIFY_EVERY = 0
DEFAULT_SIMPLIFY_TOLERANCE = 0.05
DEFAULT_PLANAR_ANGLE_DEGREES = 0.01
DEFAULT_PLANAR_QEM_MAX_ITERATIONS = 500
DEFAULT_MIN_REGION_FACES = 3


@dataclass
class ReductionProfile:
    calls: int = 0
    successful_calls: int = 0
    faces_removed: int = 0
    extract_seconds: float = 0.0
    qem_seconds: float = 0.0
    rebuild_seconds: float = 0.0
    total_seconds: float = 0.0
    last_extract_seconds: float = 0.0
    last_qem_seconds: float = 0.0
    last_rebuild_seconds: float = 0.0
    last_total_seconds: float = 0.0
    last_faces_removed: int = 0
    last_input_faces: int = 0
    last_output_faces: int = 0

    def record(
        self,
        *,
        extract_seconds: float,
        qem_seconds: float,
        rebuild_seconds: float,
        total_seconds: float,
        input_faces: int,
        output_faces: int,
    ) -> None:
        self.calls += 1
        self.extract_seconds += extract_seconds
        self.qem_seconds += qem_seconds
        self.rebuild_seconds += rebuild_seconds
        self.total_seconds += total_seconds
        self.last_extract_seconds = extract_seconds
        self.last_qem_seconds = qem_seconds
        self.last_rebuild_seconds = rebuild_seconds
        self.last_total_seconds = total_seconds
        self.last_input_faces = input_faces
        self.last_output_faces = output_faces
        self.last_faces_removed = max(0, input_faces - output_faces)
        if output_faces < input_faces:
            self.successful_calls += 1
            self.faces_removed += input_faces - output_faces


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a Manifold milling simulation using the stock STL bounds and the selected pocket toolpath.",
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
        help="Limit how many toolpath positions are applied after interpolation.",
    )
    parser.add_argument(
        "--interpolation-distance",
        type=float,
        default=DEFAULT_INTERPOLATION_DISTANCE,
        help=(
            "Maximum spacing in mm between consecutive simulated tool positions "
            f"after interpolation (default: {DEFAULT_INTERPOLATION_DISTANCE})"
        ),
    )
    parser.add_argument(
        "--simplify-every",
        type=int,
        default=DEFAULT_SIMPLIFY_EVERY,
        help=(
            "Run planar QEM simplification every N simulated tool steps and once more "
            "at the end to keep the triangle count down. Use 0 to disable and pass "
            f"a positive value to enable (default: {DEFAULT_SIMPLIFY_EVERY})"
        ),
    )
    parser.add_argument(
        "--simplify-tolerance",
        type=float,
        default=DEFAULT_SIMPLIFY_TOLERANCE,
        help=(
            "Legacy positive value used to enable periodic planar QEM simplification. "
            f"The actual angle tolerance is fixed at {DEFAULT_PLANAR_ANGLE_DEGREES}° to "
            "match planar_simplify_qem.py."
        ),
    )
    return parser.parse_args()


def load_binary_stl_bounds(path: Path) -> tuple[np.ndarray, np.ndarray]:
    with path.open("rb") as handle:
        _header = handle.read(80)
        triangle_count_bytes = handle.read(4)

        if len(triangle_count_bytes) != 4:
            raise ValueError(f"{path} is not a binary STL file.")

        triangle_count = struct.unpack("<I", triangle_count_bytes)[0]
        payload = handle.read()

    expected_payload_size = triangle_count * 50
    if len(payload) != expected_payload_size:
        raise ValueError(
            f"{path} does not look like a binary STL file: expected {expected_payload_size} bytes of triangle data, got {len(payload)}.",
        )

    min_corner = np.array([math.inf, math.inf, math.inf], dtype=np.float64)
    max_corner = np.array([-math.inf, -math.inf, -math.inf], dtype=np.float64)

    for record in struct.iter_unpack("<12fH", payload):
        for x, y, z in (
            (record[3], record[4], record[5]),
            (record[6], record[7], record[8]),
            (record[9], record[10], record[11]),
        ):
            if x < min_corner[0]:
                min_corner[0] = x
            if y < min_corner[1]:
                min_corner[1] = y
            if z < min_corner[2]:
                min_corner[2] = z

            if x > max_corner[0]:
                max_corner[0] = x
            if y > max_corner[1]:
                max_corner[1] = y
            if z > max_corner[2]:
                max_corner[2] = z

    return min_corner, max_corner


def ensure_triangle_faces(faces: np.ndarray) -> np.ndarray:
    face_array = np.asarray(faces, dtype=np.int32)
    if face_array.ndim != 2 or face_array.shape[1] != 3:
        raise ValueError(f"Expected a triangular face array of shape (m, 3), got {face_array.shape}.")
    return face_array


def build_box_mesh(bounds_min: np.ndarray, bounds_max: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    xmin, ymin, zmin = bounds_min.astype(np.float64)
    xmax, ymax, zmax = bounds_max.astype(np.float64)

    vertices = np.array(
        [
            [xmin, ymin, zmin],
            [xmax, ymin, zmin],
            [xmax, ymax, zmin],
            [xmin, ymax, zmin],
            [xmin, ymin, zmax],
            [xmax, ymin, zmax],
            [xmax, ymax, zmax],
            [xmin, ymax, zmax],
        ],
        dtype=np.float64,
    )

    faces = np.array(
        [
            [0, 2, 1],
            [0, 3, 2],
            [4, 5, 6],
            [4, 6, 7],
            [0, 1, 5],
            [0, 5, 4],
            [1, 2, 6],
            [1, 6, 5],
            [2, 3, 7],
            [2, 7, 6],
            [3, 0, 4],
            [3, 4, 7],
        ],
        dtype=np.int32,
    )

    return vertices, faces


def build_cylinder_mesh(
    diameter: float,
    height: float,
    segments: int,
) -> tuple[np.ndarray, np.ndarray]:
    radius = diameter / 2.0
    angles = np.linspace(0.0, math.tau, segments, endpoint=False, dtype=np.float64)

    bottom_ring = np.column_stack(
        [
            radius * np.cos(angles),
            radius * np.sin(angles),
            np.zeros(segments, dtype=np.float64),
        ]
    )
    top_ring = bottom_ring.copy()
    top_ring[:, 2] = height

    vertices = np.vstack(
        [
            np.array([[0.0, 0.0, 0.0]], dtype=np.float64),
            np.array([[0.0, 0.0, height]], dtype=np.float64),
            bottom_ring,
            top_ring,
        ],
    )

    bottom_center = 0
    top_center = 1
    bottom_start = 2
    top_start = 2 + segments

    faces: list[list[int]] = []
    for index in range(segments):
        next_index = (index + 1) % segments

        bottom_i = bottom_start + index
        bottom_j = bottom_start + next_index
        top_i = top_start + index
        top_j = top_start + next_index

        # Bottom cap faces downward (-Z).
        faces.append([bottom_center, bottom_j, bottom_i])
        # Top cap faces upward (+Z).
        faces.append([top_center, top_i, top_j])
        # Side wall.
        faces.append([bottom_i, bottom_j, top_j])
        faces.append([bottom_i, top_j, top_i])

    return vertices, np.asarray(faces, dtype=np.int32)


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


def interpolate_tool_positions(
    positions: list[np.ndarray],
    max_distance: float,
) -> list[np.ndarray]:
    if max_distance <= 0.0:
        raise ValueError(f"Interpolation distance must be positive, got {max_distance}.")

    if not positions:
        return []

    interpolated = [np.asarray(positions[0], dtype=np.float64)]
    previous = interpolated[0]

    for current in positions[1:]:
        current_position = np.asarray(current, dtype=np.float64)
        delta = current_position - previous
        distance = float(np.linalg.norm(delta))

        if distance <= 1e-12:
            continue

        segment_count = max(1, int(math.ceil(distance / max_distance)))
        for segment_index in range(1, segment_count + 1):
            fraction = segment_index / segment_count
            interpolated.append(previous + fraction * delta)

        previous = current_position

    return interpolated


def format_manifold_error(status: Error) -> str:
    return getattr(status, "name", str(status))


def ensure_no_manifold_error(manifold: Manifold, *, context: str) -> Manifold:
    status = manifold.status()
    if status != Error.NoError:
        raise RuntimeError(f"Manifold returned {format_manifold_error(status)} during {context}.")
    return manifold


def mesh_to_manifold(
    vertices: np.ndarray,
    faces: np.ndarray,
    *,
    context: str,
) -> Manifold:
    mesh = Mesh64(
        np.ascontiguousarray(vertices, dtype=np.float64),
        np.ascontiguousarray(ensure_triangle_faces(faces), dtype=np.uint64),
    )
    return ensure_no_manifold_error(Manifold(mesh), context=context)


def to_xyz(values: np.ndarray) -> tuple[float, float, float]:
    array = np.asarray(values, dtype=np.float64).reshape(3)
    return float(array[0]), float(array[1]), float(array[2])


def subtract_manifold(
    stock: Manifold,
    tool: Manifold,
    *,
    context: str,
) -> Manifold:
    return ensure_no_manifold_error(stock - tool, context=context)


def simplify_manifold(
    manifold: Manifold,
    tolerance: float,
    *,
    context: str,
    profile: ReductionProfile | None = None,
    qem_profile: QEMProfile | None = None,
) -> Manifold:
    """Simplify a manifold using the shared planar QEM reducer.

    The ``tolerance`` knob is now only used as an enable/disable toggle; the
    actual planar angle tolerance matches ``planar_simplify_qem.py``.
    """
    if tolerance < 0.0:
        raise ValueError(f"Simplification tolerance must be non-negative, got {tolerance}.")
    if tolerance <= 0.0:
        return manifold

    total_start = time.perf_counter()
    extract_start = time.perf_counter()
    mesh = ensure_no_manifold_error(manifold, context=context).to_mesh64()
    extract_seconds = time.perf_counter() - extract_start
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(mesh.tri_verts, dtype=np.int32))
    if vertices.ndim != 2 or vertices.shape[1] < 3:
        raise ValueError(f"Expected Mesh64.vert_properties to have at least 3 columns, got {vertices.shape}.")

    qem_start = time.perf_counter()
    simplified_mesh = simplify_mesh_data(
        vertices[:, :3],
        faces,
        max_iterations=DEFAULT_PLANAR_QEM_MAX_ITERATIONS,
        planar_angle_degrees=DEFAULT_PLANAR_ANGLE_DEGREES,
        min_region_faces=DEFAULT_MIN_REGION_FACES,
        verbose=False,
        profile=qem_profile,
    )
    qem_seconds = time.perf_counter() - qem_start
    simplified_vertices = np.asarray(simplified_mesh.vertices, dtype=np.float64)
    simplified_faces = ensure_triangle_faces(np.asarray(simplified_mesh.faces, dtype=np.int32))

    if len(simplified_faces) >= len(faces):
        total_seconds = time.perf_counter() - total_start
        if profile is not None:
            profile.record(
                extract_seconds=extract_seconds,
                qem_seconds=qem_seconds,
                rebuild_seconds=0.0,
                total_seconds=total_seconds,
                input_faces=len(faces),
                output_faces=len(faces),
            )
        return manifold

    rebuild_start = time.perf_counter()
    try:
        simplified_manifold = mesh_to_manifold(
            simplified_vertices,
            simplified_faces,
            context=context,
        )
    except Exception as exc:
        rebuild_seconds = time.perf_counter() - rebuild_start
        print(f"    planar reduction at {context} failed to convert back to Manifold: {exc}")
        total_seconds = time.perf_counter() - total_start
        if profile is not None:
            profile.record(
                extract_seconds=extract_seconds,
                qem_seconds=qem_seconds,
                rebuild_seconds=rebuild_seconds,
                total_seconds=total_seconds,
                input_faces=len(faces),
                output_faces=len(faces),
            )
        return manifold

    rebuild_seconds = time.perf_counter() - rebuild_start
    returned_faces = len(faces)
    if simplified_manifold.num_tri() <= manifold.num_tri():
        returned_faces = simplified_manifold.num_tri()
        result = simplified_manifold
    else:
        result = manifold

    total_seconds = time.perf_counter() - total_start
    if profile is not None:
        profile.record(
            extract_seconds=extract_seconds,
            qem_seconds=qem_seconds,
            rebuild_seconds=rebuild_seconds,
            total_seconds=total_seconds,
            input_faces=len(faces),
            output_faces=returned_faces,
        )

    return result


def write_off(path: Path, manifold: Manifold) -> None:
    mesh = ensure_no_manifold_error(manifold, context=f"writing {path}").to_mesh64()
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = np.asarray(mesh.tri_verts, dtype=np.uint64)

    if vertices.ndim != 2 or vertices.shape[1] < 3:
        raise ValueError(f"Expected Mesh64.vert_properties to have at least 3 columns, got {vertices.shape}.")
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError(f"Expected Mesh64.tri_verts to have shape (m, 3), got {faces.shape}.")

    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        handle.write("OFF\n")
        handle.write(f"{len(vertices)} {len(faces)} 0\n")

        for x, y, z in vertices[:, :3]:
            handle.write(f"{x:.10f} {y:.10f} {z:.10f}\n")

        for a, b, c in faces:
            handle.write(f"3 {int(a)} {int(b)} {int(c)}\n")


def write_stl(path: Path, manifold: Manifold) -> None:
    mesh = ensure_no_manifold_error(manifold, context=f"writing {path}").to_mesh64()
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = np.asarray(mesh.tri_verts, dtype=np.uint64)

    if vertices.ndim != 2 or vertices.shape[1] < 3:
        raise ValueError(f"Expected Mesh64.vert_properties to have at least 3 columns, got {vertices.shape}.")
    if faces.ndim != 2 or faces.shape[1] != 3:
        raise ValueError(f"Expected Mesh64.tri_verts to have shape (m, 3), got {faces.shape}.")

    path.parent.mkdir(parents=True, exist_ok=True)
    header = b"Generated by test_milling_simulation_manifold.py"
    with path.open("wb") as handle:
        handle.write(header.ljust(80, b"\0")[:80])
        handle.write(struct.pack("<I", len(faces)))

        for a, b, c in faces:
            p0 = vertices[int(a), :3]
            p1 = vertices[int(b), :3]
            p2 = vertices[int(c), :3]
            normal = np.cross(p1 - p0, p2 - p0)
            normal_length = float(np.linalg.norm(normal))
            if normal_length > 0.0:
                normal = normal / normal_length
            else:
                normal = np.zeros(3, dtype=np.float64)

            handle.write(
                struct.pack(
                    "<12fH",
                    float(normal[0]),
                    float(normal[1]),
                    float(normal[2]),
                    float(p0[0]),
                    float(p0[1]),
                    float(p0[2]),
                    float(p1[0]),
                    float(p1[1]),
                    float(p1[2]),
                    float(p2[0]),
                    float(p2[1]),
                    float(p2[2]),
                    0,
                )
            )


def launch_meshlab(path: Path) -> None:
    meshlab_path = shutil.which("meshlab")
    if meshlab_path is not None:
        meshlab_command = [meshlab_path, str(path)]
        print(f"Launching Meshlab: {' '.join(meshlab_command)}")
        subprocess.run(meshlab_command, check=False)
        return

    if sys.platform == "darwin":
        meshlab_command = ["open", "-a", "MeshLab", str(path)]
        print(f"Launching Meshlab: {' '.join(meshlab_command)}")
        subprocess.run(meshlab_command, check=False)
        return

    print("Meshlab was not found on PATH, so the viewer step was skipped.")


def main() -> int:
    args = parse_args()

    if args.simplify_every < 0:
        raise ValueError(f"--simplify-every must be non-negative, got {args.simplify_every}.")
    if args.simplify_tolerance < 0.0:
        raise ValueError(
            f"--simplify-tolerance must be non-negative, got {args.simplify_tolerance}.",
        )

    stock_min, stock_max = load_binary_stl_bounds(STOCK_STL_PATH)
    stock_vertices, stock_faces = build_box_mesh(stock_min, stock_max)
    tool_vertices, tool_faces = build_cylinder_mesh(
        TOOL_DIAMETER,
        TOOL_HEIGHT,
        TOOL_SEGMENTS,
    )
    stock_manifold = mesh_to_manifold(stock_vertices, stock_faces, context="stock mesh import")
    tool_manifold = mesh_to_manifold(tool_vertices, tool_faces, context="tool mesh import")
    original_positions = load_tool_positions(TOOLPATH_JSON_PATH)
    interpolated_positions = interpolate_tool_positions(original_positions, args.interpolation_distance)
    positions = interpolated_positions

    if args.max_steps is not None:
        positions = positions[: max(args.max_steps, 0)]

    print(f"Loaded {len(original_positions)} tool positions from {TOOLPATH_JSON_PATH.name}")
    print(
        f"Interpolated to {len(interpolated_positions)} tool positions "
        f"with max spacing {args.interpolation_distance} mm"
    )
    if args.max_steps is not None:
        print(f"Using first {len(positions)} interpolated tool positions due to --max-steps")
    print(f"Stock STL: {STOCK_STL_PATH}")
    print(f"Stock bounds: min={stock_min.tolist()} max={stock_max.tolist()}")
    print(f"Tool: diameter={TOOL_DIAMETER} height={TOOL_HEIGHT} segments={TOOL_SEGMENTS}")
    planar_angle_degrees = DEFAULT_PLANAR_ANGLE_DEGREES
    if args.simplify_every > 0:
        print(
            f"Periodic planar QEM simplification: every {args.simplify_every} steps "
            f"at angle tolerance {planar_angle_degrees:.2f}° "
            f"(min {DEFAULT_MIN_REGION_FACES} faces/region, "
            f"max {DEFAULT_PLANAR_QEM_MAX_ITERATIONS} iterations)"
        )
    else:
        print("Periodic planar QEM simplification: disabled (pass --simplify-every N to enable)")

    subtraction_seconds = 0.0
    reduction_wall_seconds = 0.0
    reduction_profile = ReductionProfile()
    current = stock_manifold

    for step, position in enumerate(positions, start=1):
        moved_tool = tool_manifold.translate(to_xyz(position))
        subtraction_start = time.perf_counter()
        current = subtract_manifold(
            current,
            moved_tool,
            context=f"difference at step {step} for tool position {position.tolist()}",
        )
        subtraction_seconds += time.perf_counter() - subtraction_start

        if args.simplify_every > 0 and step % args.simplify_every == 0:
            before_vertices = current.num_vert()
            before_triangles = current.num_tri()
            reduction_start = time.perf_counter()
            call_qem_profile = QEMProfile()
            simplified = simplify_manifold(
                current,
                args.simplify_tolerance,
                context=f"planar QEM simplification at step {step}",
                profile=reduction_profile,
                qem_profile=call_qem_profile,
            )
            reduction_wall_seconds += time.perf_counter() - reduction_start
            after_vertices = simplified.num_vert()
            after_triangles = simplified.num_tri()

            if after_triangles <= before_triangles:
                current = simplified
                reduction_status = "reduced"
            else:
                after_vertices = before_vertices
                after_triangles = before_triangles
                reduction_status = "kept original"

            print(
                f"    planar QEM {reduction_status} at step {step}: "
                f"{before_vertices} -> {after_vertices} vertices, "
                f"{before_triangles} -> {after_triangles} faces "
                f"({reduction_profile.last_total_seconds:.3f}s total; "
                f"extract {reduction_profile.last_extract_seconds:.3f}s, "
                f"qem {reduction_profile.last_qem_seconds:.3f}s, "
                f"rebuild {reduction_profile.last_rebuild_seconds:.3f}s)"
            )
            print(format_qem_profile(call_qem_profile, indent="      "))

        if step == 1 or step % 10 == 0 or step == len(positions):
            print(
                f"  step {step}/{len(positions)} -> {current.num_vert()} vertices, {current.num_tri()} faces",
            )

    if args.simplify_every > 0:
        final_before_vertices = current.num_vert()
        final_before_triangles = current.num_tri()
        reduction_start = time.perf_counter()
        call_qem_profile = QEMProfile()
        final_simplified = simplify_manifold(
            current,
            args.simplify_tolerance,
            context="final planar QEM simplification before writing output",
            profile=reduction_profile,
            qem_profile=call_qem_profile,
        )
        reduction_wall_seconds += time.perf_counter() - reduction_start
        final_after_vertices = final_simplified.num_vert()
        final_after_triangles = final_simplified.num_tri()

        if final_after_triangles <= final_before_triangles:
            current = final_simplified
            reduction_status = "reduced"
        else:
            final_after_vertices = final_before_vertices
            final_after_triangles = final_before_triangles
            reduction_status = "kept original"

        print(
            f"    planar QEM {reduction_status} at end: "
            f"{final_before_vertices} -> {final_after_vertices} vertices, "
            f"{final_before_triangles} -> {final_after_triangles} faces "
            f"({reduction_profile.last_total_seconds:.3f}s total; "
            f"extract {reduction_profile.last_extract_seconds:.3f}s, "
            f"qem {reduction_profile.last_qem_seconds:.3f}s, "
            f"rebuild {reduction_profile.last_rebuild_seconds:.3f}s)"
        )
        print(format_qem_profile(call_qem_profile, indent="      "))

    stl_output_path = DEFAULT_OUTPUT_DIR / f"{args.output.stem}.stl"
    write_off(args.output, current)
    write_stl(stl_output_path, current)
    print(f"Subtraction took {subtraction_seconds:.3f} seconds")
    if reduction_profile.calls > 0:
        average_reduction_seconds = reduction_profile.total_seconds / reduction_profile.calls
        print("\nPlanar reduction profile:")
        print(f"  Calls:                {reduction_profile.calls}")
        print(f"  Successful calls:     {reduction_profile.successful_calls}")
        print(f"  Faces removed:        {reduction_profile.faces_removed}")
        print(f"  Internal timer total:  {reduction_profile.total_seconds:.3f} seconds")
        print(f"  Wall time around API:  {reduction_wall_seconds:.3f} seconds")
        print(f"  Extract Mesh64 time:   {reduction_profile.extract_seconds:.3f} seconds")
        print(f"  QEM simplify time:     {reduction_profile.qem_seconds:.3f} seconds")
        print(f"  Rebuild Manifold time: {reduction_profile.rebuild_seconds:.3f} seconds")
        print(f"  Average per call:      {average_reduction_seconds:.3f} seconds")
    print(f"Wrote {args.output}")
    print(f"Wrote {stl_output_path}")

    launch_meshlab(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
