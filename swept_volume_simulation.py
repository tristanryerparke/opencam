import base64
import io
import math
import struct

import numpy as np
import trimesh
from manifold3d import Error, Manifold, Mesh64

from models import ToolpathOperation
from planar_region_2d_reduction import simplify_mesh_data_2d

TOOL_SEGMENTS = 32
DEFAULT_PLANAR_ANGLE_DEGREES = 0.01
DEFAULT_MIN_REGION_FACES = 3


def decode_mesh_data_url(mesh_data_url: str) -> bytes:
    header, separator, encoded = mesh_data_url.partition(",")
    if not separator or not header.endswith(";base64"):
        raise ValueError("Mesh payload must be a base64 data URL.")
    try:
        return base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("Mesh payload is not valid base64 data.") from exc


def load_stl_bounds(stl_bytes: bytes) -> tuple[np.ndarray, np.ndarray]:
    mesh = trimesh.load(io.BytesIO(stl_bytes), file_type="stl", force="mesh")
    bounds = np.asarray(mesh.bounds, dtype=np.float64)
    if bounds.shape != (2, 3):
        raise ValueError("Unable to determine STL bounds.")
    return bounds[0], bounds[1]


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


def build_cylinder_mesh(diameter: float, height: float, segments: int) -> tuple[np.ndarray, np.ndarray]:
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
        ]
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
        faces.append([bottom_center, bottom_j, bottom_i])
        faces.append([top_center, top_i, top_j])
        faces.append([bottom_i, bottom_j, top_j])
        faces.append([bottom_i, top_j, top_i])

    return vertices, np.asarray(faces, dtype=np.int32)


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
    mesh = ensure_no_manifold_error(manifold, context=context).to_mesh64()
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(mesh.tri_verts, dtype=np.int32))
    return vertices[:, :3], faces


def rotation_matrix_about_z_to_face_xy_direction(direction: np.ndarray) -> np.ndarray:
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


def swept_volume_manifold(
    tool_verts: np.ndarray,
    *,
    end_verts: np.ndarray,
    context: str,
) -> Manifold:
    start_xyz = np.asarray(tool_verts, dtype=np.float64)[:, :3]
    end_xyz = np.asarray(end_verts, dtype=np.float64)[:, :3]
    if start_xyz.shape != end_xyz.shape:
        raise ValueError(
            f"Start and end vertex arrays must have matching shapes, got {start_xyz.shape} and {end_xyz.shape}."
        )

    all_points = np.vstack([start_xyz, end_xyz])
    hull_manifold = Manifold.hull_points(np.ascontiguousarray(all_points, dtype=np.float64))
    return ensure_no_manifold_error(hull_manifold, context=context)


def load_tool_positions(operation: ToolpathOperation) -> list[np.ndarray]:
    positions: list[np.ndarray] = []
    previous: np.ndarray | None = None

    for path in operation.paths:
        for location in path.locations:
            position = np.array([location.x, location.y, location.z], dtype=np.float64)
            if previous is not None and np.allclose(position, previous, atol=1e-9, rtol=0.0):
                continue
            positions.append(position)
            previous = position

    return positions


def simplify_planar_mesh(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    vertex_array = np.asarray(vertices, dtype=np.float64)
    face_array = ensure_triangle_faces(faces)
    if len(face_array) == 0:
        return vertex_array[:, :3], face_array

    simplified = simplify_mesh_data_2d(
        vertex_array[:, :3],
        face_array,
        planar_angle_degrees=DEFAULT_PLANAR_ANGLE_DEGREES,
        min_region_faces=DEFAULT_MIN_REGION_FACES,
        verbose=False,
    )
    simplified_vertices = np.asarray(simplified.vertices, dtype=np.float64)
    simplified_faces = ensure_triangle_faces(np.asarray(simplified.faces, dtype=np.int32))

    if len(simplified_faces) >= len(face_array):
        return vertex_array[:, :3], face_array

    return simplified_vertices, simplified_faces


def write_binary_stl(vertices: np.ndarray, faces: np.ndarray) -> bytes:
    vertex_array = np.asarray(vertices, dtype=np.float64)
    face_array = ensure_triangle_faces(faces)
    header = b"Generated by swept_volume_simulation.py"

    buffer = io.BytesIO()
    buffer.write(header.ljust(80, b"\0")[:80])
    buffer.write(struct.pack("<I", len(face_array)))

    for a, b, c in face_array:
        p0 = vertex_array[int(a), :3]
        p1 = vertex_array[int(b), :3]
        p2 = vertex_array[int(c), :3]
        normal = np.cross(p1 - p0, p2 - p0)
        normal_length = float(np.linalg.norm(normal))
        normal = normal / normal_length if normal_length > 0.0 else np.zeros(3, dtype=np.float64)
        buffer.write(
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

    return buffer.getvalue()


def simulate_swept_milling(mesh_data_url: str, operation: ToolpathOperation) -> str:
    stock_min, stock_max = load_stl_bounds(decode_mesh_data_url(mesh_data_url))
    stock_vertices, stock_faces = build_box_mesh(stock_min, stock_max)
    stock_manifold = mesh_to_manifold(stock_vertices, stock_faces, context="stock mesh import")

    tool_vertices, _tool_faces = build_cylinder_mesh(
        operation.tool.diameter,
        operation.tool.cutting_height,
        TOOL_SEGMENTS,
    )
    positions = load_tool_positions(operation)
    current = stock_manifold

    for step in range(1, len(positions)):
        pos_a = positions[step - 1]
        pos_b = positions[step]
        translation = pos_b - pos_a
        if np.linalg.norm(translation) < 1e-9:
            continue

        sweep_rotation = rotation_matrix_about_z_to_face_xy_direction(translation)
        rotated_tool_vertices = tool_vertices @ sweep_rotation.T
        start_sweep_vertices = rotated_tool_vertices + pos_a[None, :]
        end_sweep_vertices = rotated_tool_vertices + pos_b[None, :]
        swept_manifold = swept_volume_manifold(
            start_sweep_vertices,
            end_verts=end_sweep_vertices,
            context=f"swept volume for segment {step}",
        )
        current = ensure_no_manifold_error(
            current - swept_manifold,
            context=f"subtraction at segment {step}",
        )

    components = current.decompose()
    if len(components) > 1:
        current = max(components, key=lambda manifold: manifold.num_tri())

    final_vertices, final_faces = manifold_to_mesh(current, context="extracting final swept stock mesh")
    final_vertices, final_faces = simplify_planar_mesh(final_vertices, final_faces)
    milled_stl = write_binary_stl(final_vertices, final_faces)
    milled_stl_base64 = base64.b64encode(milled_stl).decode("ascii")
    return f"data:model/stl;base64,{milled_stl_base64}"
