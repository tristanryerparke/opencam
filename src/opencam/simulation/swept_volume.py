import base64
import io
import math
import os
import shutil
import struct
import subprocess
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
from itertools import pairwise

import numpy as np
import trimesh
from manifold3d import Error, Manifold, Mesh64, OpType
from opencam._cgal_planar import remesh_planar_patches

from opencam.engine.arc import linearize_arc_records, linearize_arc_records_with_indices
from opencam_contracts.cl_data import OperationRecord3D, PositionRecord3D
from opencam.services.tool_mesh import (
    build_tool_mesh_glb_from_tool,
    build_tool_mesh_vertices_faces,
)

SIM_STEPDISTANCE = 5
ARC_SIMULATION_CHORD_TOLERANCE = 0.01
SIMPLIFY_AFTER_EACH_CHUNK = False
DEFAULT_MAX_SIM_DISTANCE = 20
DEFAULT_CHUNK_PADDING = (5.0, 5.0, 1.0)
DEFAULT_CHUNK_STEP_DISTANCE = 0.5
DEFAULT_RAPID_FRAME_STEP_SCALE = 4.0
DEFAULT_PATH_ANGLE_TOLERANCE_DEGREES = 15
DEFAULT_STRAIGHT_LINE_TOLERANCE_DEGREES = 2
DEFAULT_ROTATE_TOOL_WITH_PATH = False
DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS = True
STOCK_FACE_COLOR_RGBA = np.array([251, 146, 60, 255], dtype=np.uint8)
CUT_FACE_COLOR_RGBA = np.array([156, 163, 175, 255], dtype=np.uint8)

# EXT_meshopt_compression (via gltfpack) for served GLBs. Global flag + size
# threshold; no-op when disabled, when the mesh is too small, or when gltfpack is
# not on PATH. The frontend GLTFLoader must register MeshoptDecoder to consume
# these (enable there before flipping OPENCAM_MESHOPT_COMPRESSION=1).
MESHOPT_COMPRESSION_ENABLED = os.getenv("OPENCAM_MESHOPT_COMPRESSION", "").lower() in ("1", "true", "yes", "on")
MESHOPT_COMPRESSION_MIN_BYTES = int(os.getenv("OPENCAM_MESHOPT_MIN_BYTES", str(256 * 1024)))


@dataclass
class SimulatedChunk:
    cached_mesh_bytes: bytes
    frame_start_index: int
    frame_end_index: int


@dataclass
class SimulatedMeshFrame:
    active_mesh_bytes: bytes
    tool_position: PositionRecord3D
    chunk_index: int


@dataclass
class ChunkClData:
    tool_vertices: np.ndarray
    tool_axis: tuple[float, ...]
    clearance_plane_height: float
    points: list[PositionRecord3D]


@dataclass
class PreparedSimulationChunk:
    chunk_index: int
    focus_mesh: Manifold
    rest_mesh: Manifold
    cl_data: ChunkClData
    stock_like_original_ids: set[int]


class SimulationCancelledError(RuntimeError):
    pass


def decode_mesh_data_url(mesh_data_url: str) -> bytes:
    header, separator, encoded = mesh_data_url.partition(",")
    if not separator or not header.endswith(";base64"):
        raise ValueError("Mesh payload must be a base64 data URL.")
    try:
        return base64.b64decode(encoded, validate=True)
    except ValueError as exc:
        raise ValueError("Mesh payload is not valid base64 data.") from exc


def encode_mesh_data_url(mesh_bytes: bytes) -> str:
    mesh_base64 = base64.b64encode(mesh_bytes).decode("ascii")
    return f"data:model/stl;base64,{mesh_base64}"


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


def format_manifold_error(status: Error) -> str:
    return getattr(status, "name", str(status))


def ensure_no_manifold_error(manifold: Manifold, *, context: str) -> Manifold:
    status = manifold.status()
    if status != Error.NoError:
        raise RuntimeError(f"Manifold error during {context}: {format_manifold_error(status)}")
    return manifold


def mesh_to_manifold(
    vertices: np.ndarray,
    faces: np.ndarray,
    *,
    context: str,
    original_id: int | None = None,
) -> Manifold:
    mesh_kwargs: dict[str, np.ndarray] = {}
    if original_id is not None:
        mesh_kwargs = {
            "run_index": np.array([0], dtype=np.uint64),
            "run_original_id": np.array([original_id], dtype=np.uint32),
        }

    mesh = Mesh64(
        np.ascontiguousarray(vertices, dtype=np.float64),
        np.ascontiguousarray(ensure_triangle_faces(faces), dtype=np.uint64),
        **mesh_kwargs,
    )
    return ensure_no_manifold_error(Manifold(mesh), context=context)


def boolean_manifolds(
    manifolds: list[Manifold],
    operation: OpType,
    *,
    context: str,
) -> Manifold:
    return ensure_no_manifold_error(
        Manifold.batch_boolean(manifolds, operation),
        context=context,
    )


def manifold_to_mesh(manifold: Manifold, *, context: str) -> tuple[np.ndarray, np.ndarray]:
    mesh = ensure_no_manifold_error(manifold, context=context).to_mesh64()
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(mesh.tri_verts, dtype=np.int32))
    return vertices[:, :3], faces


def face_original_ids_from_mesh(mesh: Mesh64, face_count: int) -> np.ndarray:
    face_original_ids = np.full(face_count, -1, dtype=np.int64)
    run_index = np.asarray(mesh.run_index, dtype=np.int64)
    run_original_id = np.asarray(mesh.run_original_id, dtype=np.int64)

    if len(run_index) < 2 or len(run_original_id) == 0:
        return face_original_ids

    for original_id, run_start, run_end in zip(
        run_original_id,
        run_index[:-1],
        run_index[1:],
        strict=False,
    ):
        start_face = max(int(run_start // 3), 0)
        end_face = min(int(math.ceil(run_end / 3)), face_count)
        if start_face < end_face:
            face_original_ids[start_face:end_face] = int(original_id)

    return face_original_ids


def manifold_to_labeled_mesh(
    manifold: Manifold,
    *,
    context: str,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    mesh = ensure_no_manifold_error(manifold, context=context).to_mesh64()
    vertices = np.asarray(mesh.vert_properties, dtype=np.float64)
    faces = ensure_triangle_faces(np.asarray(mesh.tri_verts, dtype=np.int32))
    face_original_ids = face_original_ids_from_mesh(mesh, len(faces))
    return vertices[:, :3], faces, face_original_ids


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


def tool_rotation_matrix(direction: np.ndarray, *, rotate_tool_with_path: bool) -> np.ndarray:
    if not rotate_tool_with_path:
        return np.eye(3, dtype=np.float64)
    return rotation_matrix_about_z_to_face_xy_direction(direction)


def xy_unit_direction(vector: np.ndarray) -> np.ndarray | None:
    xy = np.asarray(vector, dtype=np.float64)[:2]
    norm = float(np.linalg.norm(xy))
    if norm < 1e-12:
        return None
    return xy / norm


def directions_form_non_collinear_turn(
    previous_translation: np.ndarray,
    next_translation: np.ndarray,
    tolerance_degrees: float,
) -> bool:
    previous_direction = xy_unit_direction(previous_translation)
    next_direction = xy_unit_direction(next_translation)
    if previous_direction is None or next_direction is None:
        return False

    min_alignment = math.cos(math.radians(max(tolerance_degrees, 0.0)))
    alignment = float(np.clip(np.dot(previous_direction, next_direction), -1.0, 1.0))
    return alignment < min_alignment


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


def load_tool_positions(operation: OperationRecord3D) -> list[np.ndarray]:
    positions: list[np.ndarray] = []
    previous: np.ndarray | None = None

    records = linearize_arc_records(
        operation.records,
        chord_tolerance=ARC_SIMULATION_CHORD_TOLERANCE,
    )
    for record in records:
        position = np.array([record.x, record.y, record.z], dtype=np.float64)
        if previous is not None and np.allclose(position, previous, atol=1e-9, rtol=0.0):
            continue
        positions.append(position)
        previous = position

    return positions


def positions_match(left: PositionRecord3D, right: PositionRecord3D, *, tolerance: float = 1e-6) -> bool:
    return (
        abs(left.x - right.x) <= tolerance
        and abs(left.y - right.y) <= tolerance
        and abs(left.z - right.z) <= tolerance
    )


def segment_parameter_for_position(
    start: PositionRecord3D,
    end: PositionRecord3D,
    position: PositionRecord3D,
    *,
    tolerance: float = 1e-6,
) -> float | None:
    start_vec = np.array([start.x, start.y, start.z], dtype=np.float64)
    end_vec = np.array([end.x, end.y, end.z], dtype=np.float64)
    position_vec = np.array([position.x, position.y, position.z], dtype=np.float64)
    segment = end_vec - start_vec
    segment_length_sq = float(np.dot(segment, segment))

    if segment_length_sq <= tolerance * tolerance:
        return 0.0 if positions_match(start, position, tolerance=tolerance) else None

    parameter = float(np.dot(position_vec - start_vec, segment) / segment_length_sq)
    if parameter < -tolerance or parameter > 1.0 + tolerance:
        return None

    projected = start_vec + segment * min(max(parameter, 0.0), 1.0)
    if np.linalg.norm(position_vec - projected) > tolerance:
        return None

    return min(max(parameter, 0.0), 1.0)


def sample_operation_points_with_progress(
    operation: OperationRecord3D,
    step_distance: float,
    rapid_frame_step_scale: float = 1.0,
) -> list[tuple[float, PositionRecord3D]]:
    records = linearize_arc_records(
        operation.records,
        chord_tolerance=ARC_SIMULATION_CHORD_TOLERANCE,
    )
    if not records:
        return []

    sampled_points: list[tuple[float, PositionRecord3D]] = [(0.0, records[0])]
    traversed_distance = 0.0
    distance_since_sample = 0.0

    for segment_start, segment_end in pairwise(records):
        dx = segment_end.x - segment_start.x
        dy = segment_end.y - segment_start.y
        dz = segment_end.z - segment_start.z
        segment_length = math.sqrt(dx * dx + dy * dy + dz * dz)

        if segment_length <= 1e-9:
            continue

        segment_traversed_start = traversed_distance
        segment_consumed = 0.0
        segment_remaining = segment_length
        segment_step_distance = (
            step_distance * rapid_frame_step_scale
            if getattr(segment_end, "feed_type", None) == "rapid"
            else step_distance
        )

        while segment_step_distance > 0 and distance_since_sample + segment_remaining >= segment_step_distance:
            distance_to_sample = max(segment_step_distance - distance_since_sample, 0.0)
            segment_consumed += distance_to_sample
            interpolation = min(segment_consumed / segment_length, 1.0)
            position = PositionRecord3D(
                x=float(segment_start.x + dx * interpolation),
                y=float(segment_start.y + dy * interpolation),
                z=float(segment_start.z + dz * interpolation),
            )
            progress = segment_traversed_start + segment_consumed

            if positions_match(sampled_points[-1][1], position):
                sampled_points[-1] = (progress, position)
            else:
                sampled_points.append((progress, position))

            distance_since_sample = 0.0
            segment_remaining = segment_length - segment_consumed
            if segment_remaining <= 1e-9:
                segment_consumed = segment_length
                break

        traversed_distance += segment_length
        distance_since_sample += segment_length - segment_consumed
        if positions_match(sampled_points[-1][1], segment_end):
            sampled_points[-1] = (traversed_distance, segment_end)
        else:
            sampled_points.append((traversed_distance, segment_end))

    return sampled_points


def map_progress_to_cl_record_indices(
    operation: OperationRecord3D,
    progresses: list[float],
) -> list[int]:
    """Map animation arclengths back to original CL moves, including whole arcs."""
    if not progresses or not operation.records:
        return []
    linearized = linearize_arc_records_with_indices(
        operation.records,
        chord_tolerance=ARC_SIMULATION_CHORD_TOLERANCE,
    )
    boundaries: list[tuple[float, int]] = []
    distance = 0.0
    for (start, _), (end, source_index) in pairwise(linearized):
        distance += math.dist((start.x, start.y, start.z), (end.x, end.y, end.z))
        boundaries.append((distance, source_index))
    if not boundaries:
        return [0] * len(progresses)

    result: list[int] = []
    cursor = 0
    for progress in progresses:
        if progress <= 0:
            result.append(0)
            continue
        while cursor < len(boundaries) - 1 and boundaries[cursor][0] < progress - 1e-9:
            cursor += 1
        result.append(boundaries[cursor][1])
    return result


def map_positions_to_operation_progress(
    operation: OperationRecord3D,
    positions: list[PositionRecord3D],
) -> list[float]:
    if not positions:
        return []

    records = linearize_arc_records(
        operation.records,
        chord_tolerance=ARC_SIMULATION_CHORD_TOLERANCE,
    )
    segments = list(pairwise(records))
    segment_lengths: list[float] = []
    cumulative_starts: list[float] = []
    cumulative_distance = 0.0
    for segment_start, segment_end in segments:
        dx = segment_end.x - segment_start.x
        dy = segment_end.y - segment_start.y
        dz = segment_end.z - segment_start.z
        length = math.sqrt(dx * dx + dy * dy + dz * dz)
        segment_lengths.append(length)
        cumulative_starts.append(cumulative_distance)
        cumulative_distance += length

    # Positions are ordered along the path, so scan forward from the last matched segment.
    # ponytail: chunking/marching can emit a position that lies on no operation segment; it
    # inherits the last known progress instead of desyncing the whole ordered match, which
    # would otherwise drop every later position and force _build_animation_frames back to
    # contact-only frames (losing the travel start/end endpoints).
    progress_values: list[float] = []
    segment_cursor = 0
    last_progress = 0.0
    for position in positions:
        matched_progress: float | None = None
        for segment_index in range(segment_cursor, len(segments)):
            length = segment_lengths[segment_index]
            if length <= 1e-9:
                continue
            parameter = segment_parameter_for_position(
                segments[segment_index][0],
                segments[segment_index][1],
                position,
            )
            if parameter is None:
                continue
            matched_progress = cumulative_starts[segment_index] + length * parameter
            segment_cursor = segment_index
            break

        if matched_progress is None:
            matched_progress = last_progress
        else:
            last_progress = matched_progress
        progress_values.append(matched_progress)

    return progress_values


def build_animation_frames(
    mesh_frames: list[SimulatedMeshFrame],
    operation: OperationRecord3D,
    initial_non_contact_frame: SimulatedMeshFrame | None = None,
    rapid_frame_step_scale: float = 1.0,
) -> list[SimulatedMeshFrame]:
    if not mesh_frames:
        return mesh_frames

    sampled_points = sample_operation_points_with_progress(
        operation,
        SIM_STEPDISTANCE,
        rapid_frame_step_scale=rapid_frame_step_scale,
    )
    if not sampled_points:
        return mesh_frames

    mesh_frame_progresses = map_positions_to_operation_progress(
        operation,
        [frame.tool_position for frame in mesh_frames],
    )
    if len(mesh_frame_progresses) != len(mesh_frames):
        return mesh_frames

    current_mesh_frame = initial_non_contact_frame or mesh_frames[0]
    mesh_frame_index = 0
    animation_frames: list[SimulatedMeshFrame] = []

    for progress, location in sampled_points:
        while (
            mesh_frame_index < len(mesh_frames)
            and mesh_frame_progresses[mesh_frame_index] <= progress + 1e-6
        ):
            current_mesh_frame = mesh_frames[mesh_frame_index]
            mesh_frame_index += 1

        animation_frames.append(
            SimulatedMeshFrame(
                active_mesh_bytes=current_mesh_frame.active_mesh_bytes,
                tool_position=location,
                chunk_index=current_mesh_frame.chunk_index,
            )
        )

    return animation_frames


def subdivide_tool_positions(positions: list[np.ndarray], step_distance: float) -> list[np.ndarray]:
    if not positions:
        return []
    if step_distance <= 0:
        return positions[:]

    subdivided_positions: list[np.ndarray] = [positions[0]]
    distance_since_subdivision = 0.0

    for index in range(1, len(positions)):
        start = positions[index - 1]
        end = positions[index]
        translation = end - start
        segment_length = float(np.linalg.norm(translation))

        if segment_length < 1e-9:
            continue

        segment_consumed = 0.0
        segment_remaining = segment_length

        while distance_since_subdivision + segment_remaining >= step_distance:
            distance_to_subdivision = step_distance - distance_since_subdivision
            if distance_to_subdivision <= 1e-9:
                distance_to_subdivision = 0.0

            segment_consumed += distance_to_subdivision
            interpolation = min(segment_consumed / segment_length, 1.0)
            subdivision = start + translation * interpolation
            if not np.allclose(subdivided_positions[-1], subdivision, atol=1e-9, rtol=0.0):
                subdivided_positions.append(subdivision)

            distance_since_subdivision = 0.0
            segment_remaining = segment_length - segment_consumed

            if segment_remaining <= 1e-9:
                segment_consumed = segment_length
                segment_remaining = 0.0
                break

        distance_since_subdivision += segment_length - segment_consumed

        if not np.allclose(subdivided_positions[-1], end, atol=1e-9, rtol=0.0):
            subdivided_positions.append(end)

    return subdivided_positions


def simplify_planar_mesh(vertices: np.ndarray, faces: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    vertex_array = np.asarray(vertices, dtype=np.float64)
    face_array = ensure_triangle_faces(faces)
    if len(face_array) == 0:
        return vertex_array[:, :3], face_array

    simplified_vertices, simplified_faces = remesh_planar_patches(
        np.ascontiguousarray(vertex_array[:, :3]),
        np.ascontiguousarray(face_array, dtype=np.int64),
    )
    simplified_faces = ensure_triangle_faces(simplified_faces)
    if len(simplified_faces) >= len(face_array):
        return vertex_array[:, :3], face_array

    return np.asarray(simplified_vertices, dtype=np.float64), simplified_faces


def simplify_labeled_mesh(
    vertices: np.ndarray,
    faces: np.ndarray,
    face_is_cut: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    vertex_array = np.asarray(vertices, dtype=np.float64)[:, :3]
    face_array = ensure_triangle_faces(faces)
    cut_array = np.asarray(face_is_cut, dtype=np.bool_)

    if len(face_array) != len(cut_array):
        raise ValueError(
            f"Expected one cut-surface flag per face, got {len(cut_array)} flags for {len(face_array)} faces."
        )

    if len(face_array) == 0:
        return vertex_array, face_array, cut_array

    vertex_parts: list[np.ndarray] = []
    face_parts: list[np.ndarray] = []
    label_parts: list[np.ndarray] = []
    vertex_offset = 0

    for is_cut_surface in (False, True):
        group_faces = face_array[cut_array == is_cut_surface]
        if len(group_faces) == 0:
            continue

        reduced_vertices, reduced_faces = simplify_planar_mesh(vertex_array, group_faces)
        if len(reduced_faces) == 0:
            continue

        vertex_parts.append(reduced_vertices)
        face_parts.append(reduced_faces + vertex_offset)
        label_parts.append(np.full(len(reduced_faces), is_cut_surface, dtype=np.bool_))
        vertex_offset += len(reduced_vertices)

    if not face_parts:
        return (
            np.zeros((0, 3), dtype=np.float64),
            np.zeros((0, 3), dtype=np.int32),
            np.zeros((0,), dtype=np.bool_),
        )

    return (
        np.vstack(vertex_parts),
        ensure_triangle_faces(np.vstack(face_parts)),
        np.concatenate(label_parts),
    )


def simplify_manifold_for_boolean(manifold: Manifold, *, context: str) -> Manifold:
    simplification_start = time.perf_counter()
    before_vertices = manifold.num_vert()
    before_faces = manifold.num_tri()
    mesh_vertices, mesh_faces = manifold_to_mesh(manifold, context=f"extracting mesh for {context}")
    reduced_vertices, reduced_faces = simplify_planar_mesh(mesh_vertices, mesh_faces)
    reduced_face_count = len(reduced_faces)
    reduced_face_percentage = (
        ((before_faces - reduced_face_count) / before_faces) * 100.0 if before_faces > 0 else 0.0
    )

    if reduced_face_count >= before_faces:
        simplification_elapsed = time.perf_counter() - simplification_start
        print(
            f"[simulate/swept]   boolean simplification kept original at {context}: "
            f"{before_vertices} vertices, {before_faces} -> {reduced_face_count} faces "
            f"({reduced_face_percentage:.2f}% reduction) in {simplification_elapsed:.3f}s"
        )
        return manifold

    try:
        simplified_manifold = mesh_to_manifold(
            reduced_vertices,
            reduced_faces,
            context=f"rebuilding manifold for {context}",
        )
    except RuntimeError as exc:
        simplification_elapsed = time.perf_counter() - simplification_start
        print(
            f"[simulate/swept]   boolean simplification rebuild failed at {context}: {exc}; "
            f"pre-rebuild faces {before_faces} -> {reduced_face_count} "
            f"({reduced_face_percentage:.2f}% reduction) in {simplification_elapsed:.3f}s; "
            "keeping original manifold"
        )
        return manifold

    after_vertices = simplified_manifold.num_vert()
    after_faces = simplified_manifold.num_tri()
    after_face_percentage = (
        ((before_faces - after_faces) / before_faces) * 100.0 if before_faces > 0 else 0.0
    )
    simplification_elapsed = time.perf_counter() - simplification_start
    if after_faces > before_faces:
        print(
            f"[simulate/swept]   boolean simplification increased face count at {context}: "
            f"{before_faces} -> {after_faces} faces ({after_face_percentage:.2f}% reduction) "
            f"in {simplification_elapsed:.3f}s; keeping original manifold"
        )
        return manifold

    print(
        f"[simulate/swept]   boolean simplification reduced {context}: "
        f"{before_vertices} -> {after_vertices} vertices, {before_faces} -> {after_faces} faces "
        f"({after_face_percentage:.2f}% reduction) in {simplification_elapsed:.3f}s"
    )
    return simplified_manifold


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


def maybe_compress_glb(glb_bytes: bytes, *, context: str) -> bytes:
    # Best-effort EXT_meshopt_compression via gltfpack (-cc). Gated by a global
    # flag and a size threshold; passes through unchanged when disabled, when
    # too small to benefit, or when the gltfpack binary is missing. Any failure
    # falls back to the uncompressed bytes so mesh serving never breaks.
    if (
        not MESHOPT_COMPRESSION_ENABLED
        or len(glb_bytes) < MESHOPT_COMPRESSION_MIN_BYTES
    ):
        return glb_bytes

    gltfpack = shutil.which("gltfpack")
    if not gltfpack:
        return glb_bytes

    try:
        with tempfile.TemporaryDirectory() as tmp:
            in_path = os.path.join(tmp, "in.glb")
            out_path = os.path.join(tmp, "out.glb")
            with open(in_path, "wb") as handle:
                handle.write(glb_bytes)
            subprocess.run(
                [gltfpack, "-i", in_path, "-o", out_path, "-cc"],
                check=True,
                capture_output=True,
            )
            with open(out_path, "rb") as handle:
                return handle.read()
    except Exception as exc:  # compression is best-effort
        print(f"[meshopt] compression failed for {context} ({len(glb_bytes)} bytes): {exc}")
        return glb_bytes


def write_glb(
    vertices: np.ndarray,
    faces: np.ndarray,
    *,
    face_is_cut: np.ndarray | None = None,
) -> bytes:
    vertex_array = np.asarray(vertices, dtype=np.float64)[:, :3]
    face_array = ensure_triangle_faces(faces)

    if face_is_cut is None:
        mesh = trimesh.Trimesh(
            vertices=vertex_array,
            faces=face_array,
            process=False,
        )
        return mesh.export(file_type="glb")

    cut_array = np.asarray(face_is_cut, dtype=np.bool_)
    if len(cut_array) != len(face_array):
        raise ValueError(
            f"Expected one cut-surface flag per face, got {len(cut_array)} flags for {len(face_array)} faces."
        )

    if len(face_array) == 0:
        mesh = trimesh.Trimesh(
            vertices=np.zeros((0, 3), dtype=np.float64),
            faces=np.zeros((0, 3), dtype=np.int32),
            process=False,
        )
        return mesh.export(file_type="glb")

    face_colors = np.where(
        cut_array[:, None],
        CUT_FACE_COLOR_RGBA[None, :],
        STOCK_FACE_COLOR_RGBA[None, :],
    ).astype(np.uint8)
    expanded_vertices = vertex_array[face_array.reshape(-1)]
    expanded_faces = np.arange(len(face_array) * 3, dtype=np.int64).reshape(-1, 3)
    vertex_colors = np.repeat(face_colors, 3, axis=0)

    mesh = trimesh.Trimesh(
        vertices=expanded_vertices,
        faces=expanded_faces,
        process=False,
    )
    mesh.visual.vertex_colors = vertex_colors
    return mesh.export(file_type="glb")


def mesh_to_data_url(vertices: np.ndarray, faces: np.ndarray) -> str:
    return encode_mesh_data_url(write_binary_stl(vertices, faces))


def position_to_record(position: np.ndarray) -> PositionRecord3D:
    return PositionRecord3D(
        x=float(position[0]),
        y=float(position[1]),
        z=float(position[2]),
    )


def record_to_position(record: PositionRecord3D) -> np.ndarray:
    return np.array([record.x, record.y, record.z], dtype=np.float64)


def load_stl_bytes(mesh_input: bytes | str) -> bytes:
    if isinstance(mesh_input, bytes):
        return mesh_input
    return decode_mesh_data_url(mesh_input)


def chunk_tool_positions(
    positions: list[np.ndarray],
    max_sim_distance: float,
) -> list[list[np.ndarray]]:
    if max_sim_distance <= 0:
        raise ValueError("max_sim_distance must be positive")

    if len(positions) <= 1:
        return [positions[:]] if positions else []

    chunks: list[list[np.ndarray]] = []
    start_index = 0

    while start_index < len(positions) - 1:
        end_index = start_index + 1
        cumulative_distance = float(np.linalg.norm(positions[end_index] - positions[start_index]))

        while end_index + 1 < len(positions):
            next_distance = float(np.linalg.norm(positions[end_index + 1] - positions[end_index]))
            if cumulative_distance + next_distance > max_sim_distance:
                break
            end_index += 1
            cumulative_distance += next_distance

        chunks.append(positions[start_index : end_index + 1])
        start_index = end_index

    if not chunks and positions:
        chunks.append(positions[:1])

    return chunks


def toolpath_chunk_bounds(
    tool_vertices: np.ndarray,
    positions: list[np.ndarray],
    padding: tuple[float, float, float],
) -> tuple[np.ndarray, np.ndarray]:
    if not positions:
        raise ValueError("Chunk positions are required")

    tool_vertices_xyz = np.asarray(tool_vertices, dtype=np.float64)[:, :3]
    position_stack = np.asarray(positions, dtype=np.float64)
    tool_min = np.min(tool_vertices_xyz, axis=0)
    tool_max = np.max(tool_vertices_xyz, axis=0)
    position_min = np.min(position_stack, axis=0)
    position_max = np.max(position_stack, axis=0)
    padding_vector = np.asarray(padding, dtype=np.float64)

    bounds_min = position_min + tool_min - padding_vector
    bounds_max = position_max + tool_max + padding_vector
    return bounds_min, bounds_max


def translated_tool_contact_box(
    tool_vertices: np.ndarray,
    stock_min: np.ndarray,
    stock_max: np.ndarray,
) -> tuple[np.ndarray, np.ndarray]:
    tool_vertices_xyz = np.asarray(tool_vertices, dtype=np.float64)[:, :3]
    tool_min = np.min(tool_vertices_xyz, axis=0)
    tool_max = np.max(tool_vertices_xyz, axis=0)
    return (
        np.asarray(stock_min, dtype=np.float64) - tool_max,
        np.asarray(stock_max, dtype=np.float64) - tool_min,
    )


def clip_segment_to_box(
    start_position: np.ndarray,
    end_position: np.ndarray,
    bounds_min: np.ndarray,
    bounds_max: np.ndarray,
) -> tuple[np.ndarray, np.ndarray] | None:
    start = np.asarray(start_position, dtype=np.float64)
    end = np.asarray(end_position, dtype=np.float64)
    direction = end - start
    t_min = 0.0
    t_max = 1.0
    tolerance = 1e-9

    for axis in range(3):
        axis_delta = float(direction[axis])
        axis_start = float(start[axis])
        axis_min = float(bounds_min[axis])
        axis_max = float(bounds_max[axis])

        if abs(axis_delta) < tolerance:
            if axis_start < axis_min - tolerance or axis_start > axis_max + tolerance:
                return None
            continue

        axis_t0 = (axis_min - axis_start) / axis_delta
        axis_t1 = (axis_max - axis_start) / axis_delta
        if axis_t0 > axis_t1:
            axis_t0, axis_t1 = axis_t1, axis_t0

        t_min = max(t_min, axis_t0)
        t_max = min(t_max, axis_t1)
        if t_min > t_max + tolerance:
            return None

    clipped_start = start + direction * max(t_min, 0.0)
    clipped_end = start + direction * min(t_max, 1.0)
    if np.allclose(clipped_start, clipped_end, atol=1e-9, rtol=0.0):
        return None
    return clipped_start, clipped_end


def filter_contact_position_sequences(
    positions: list[np.ndarray],
    tool_vertices: np.ndarray,
    stock_min: np.ndarray,
    stock_max: np.ndarray,
) -> tuple[list[list[np.ndarray]], int, int, int]:
    if len(positions) < 2:
        return [], 0, 0, 0

    contact_bounds_min, contact_bounds_max = translated_tool_contact_box(tool_vertices, stock_min, stock_max)
    contact_sequences: list[list[np.ndarray]] = []
    current_sequence: list[np.ndarray] = []
    retained_segments = 0
    skipped_segments = 0
    trimmed_segments = 0

    for index in range(1, len(positions)):
        start_position = positions[index - 1]
        end_position = positions[index]
        clipped_segment = clip_segment_to_box(
            start_position,
            end_position,
            contact_bounds_min,
            contact_bounds_max,
        )
        if clipped_segment is None:
            skipped_segments += 1
            if current_sequence:
                contact_sequences.append(current_sequence)
                current_sequence = []
            continue

        retained_segments += 1
        clipped_start, clipped_end = clipped_segment
        if not np.allclose(clipped_start, start_position, atol=1e-9, rtol=0.0) or not np.allclose(
            clipped_end,
            end_position,
            atol=1e-9,
            rtol=0.0,
        ):
            trimmed_segments += 1

        if not current_sequence:
            current_sequence.append(clipped_start)
        elif not np.allclose(current_sequence[-1], clipped_start, atol=1e-9, rtol=0.0):
            current_sequence.append(clipped_start)

        if not np.allclose(current_sequence[-1], clipped_end, atol=1e-9, rtol=0.0):
            current_sequence.append(clipped_end)

    if current_sequence:
        contact_sequences.append(current_sequence)

    return contact_sequences, retained_segments, skipped_segments, trimmed_segments


def coalesce_collinear_tool_positions(
    positions: list[np.ndarray],
    tolerance: float = 1e-8,
) -> list[np.ndarray]:
    if len(positions) <= 2:
        return positions[:]

    coalesced = [np.asarray(positions[0], dtype=np.float64), np.asarray(positions[1], dtype=np.float64)]
    for next_position in positions[2:]:
        start = coalesced[-2]
        middle = coalesced[-1]
        end = np.asarray(next_position, dtype=np.float64)
        previous = middle - start
        current = end - middle
        whole = end - start
        whole_length = float(np.linalg.norm(whole))

        if whole_length <= tolerance:
            coalesced[-1] = end
            continue

        distance_from_line = float(np.linalg.norm(np.cross(previous, whole)) / whole_length)
        if distance_from_line <= tolerance and float(np.dot(previous, current)) >= -tolerance:
            coalesced[-1] = end
            continue

        coalesced.append(end)

    return coalesced


def build_position_chunks(
    position_sequences: list[list[np.ndarray]],
    max_sim_distance: float,
    chunk_step_distance: float = DEFAULT_CHUNK_STEP_DISTANCE,
) -> tuple[list[list[np.ndarray]], int]:
    position_chunks: list[list[np.ndarray]] = []
    chunk_seed_position_count = 0

    for sequence in position_sequences:
        if not sequence:
            continue
        chunk_seed_positions = subdivide_tool_positions(
            coalesce_collinear_tool_positions(march_tool_positions(sequence, chunk_step_distance)),
            max_sim_distance,
        )
        chunk_seed_position_count += len(chunk_seed_positions)
        position_chunks.extend(chunk_tool_positions(chunk_seed_positions, max_sim_distance))

    return position_chunks, chunk_seed_position_count


def prepare_simulation_chunks(
    mesh_input: bytes | str,
    operation: OperationRecord3D,
    *,
    max_sim_distance: float = DEFAULT_MAX_SIM_DISTANCE,
    chunk_padding: tuple[float, float, float] = DEFAULT_CHUNK_PADDING,
    chunk_step_distance: float = DEFAULT_CHUNK_STEP_DISTANCE,
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH,
    should_cancel: Callable[[], bool] | None = None,
    progress_callback: Callable[[int, int, str], None] | None = None,
) -> tuple[list[PreparedSimulationChunk], Manifold]:
    if not math.isfinite(max_sim_distance) or max_sim_distance <= 0:
        raise ValueError("max_sim_distance must be positive.")
    if any(not math.isfinite(padding) or padding < 0 for padding in chunk_padding):
        raise ValueError("chunk_padding values must be non-negative.")
    if not math.isfinite(chunk_step_distance) or chunk_step_distance <= 0:
        raise ValueError("chunk_step_distance must be positive.")

    tool_vertices, _tool_faces = build_tool_mesh_vertices_faces(operation.tool)
    stock_original_id = Manifold.reserve_ids(1)
    chunk_boundary_original_id = Manifold.reserve_ids(1)

    stock_min, stock_max = load_stl_bounds(load_stl_bytes(mesh_input))
    stock_vertices, stock_faces = build_box_mesh(stock_min, stock_max)
    current_stock = mesh_to_manifold(
        stock_vertices,
        stock_faces,
        context="stock mesh import",
        original_id=stock_original_id,
    )
    original_positions = load_tool_positions(operation)
    contact_position_sequences, _retained_segments, _skipped_segments, _trimmed_segments = filter_contact_position_sequences(
        original_positions,
        tool_vertices,
        stock_min,
        stock_max,
    )
    position_chunks, _chunk_seed_position_count = build_position_chunks(
        contact_position_sequences,
        max_sim_distance,
        chunk_step_distance,
    )
    stock_like_original_ids = {stock_original_id, chunk_boundary_original_id}
    total_progress_steps = max(
        sum(1 + max(len(chunk_positions) - 1, 0) for chunk_positions in position_chunks),
        1,
    )
    completed_progress_steps = 0

    if not position_chunks:
        if progress_callback:
            progress_callback(1, 1, "No contact chunks to simulate.")

        return [
            PreparedSimulationChunk(
                chunk_index=0,
                focus_mesh=Manifold(),
                rest_mesh=current_stock,
                cl_data=ChunkClData(
                    tool_vertices=tool_vertices,
                    tool_axis=tuple(float(axis) for axis in operation.tool_axis),
                    clearance_plane_height=float(operation.clearance_plane_height),
                    points=[],
                ),
                stock_like_original_ids=stock_like_original_ids,
            )
        ], current_stock

    prepared_chunks: list[PreparedSimulationChunk] = []

    for chunk_index, chunk_positions in enumerate(position_chunks):
        if should_cancel and should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        chunk_start_progress = completed_progress_steps
        chunk_target_progress = chunk_start_progress + 1 + max(len(chunk_positions) - 1, 0)
        chunk_bounds_min, chunk_bounds_max = toolpath_chunk_bounds(
            tool_vertices,
            chunk_positions,
            chunk_padding,
        )
        chunk_box_vertices, chunk_box_faces = build_box_mesh(chunk_bounds_min, chunk_bounds_max)
        chunk_box_manifold = mesh_to_manifold(
            chunk_box_vertices,
            chunk_box_faces,
            context=f"chunk {chunk_index} bounds",
            original_id=chunk_boundary_original_id,
        )

        focus_mesh = boolean_manifolds(
            [current_stock, chunk_box_manifold],
            OpType.Intersect,
            context=f"chunk {chunk_index} focus intersection",
        )
        rest_mesh = ensure_no_manifold_error(
            current_stock - chunk_box_manifold,
            context=f"chunk {chunk_index} rest subtraction",
        )
        prepared_chunk = PreparedSimulationChunk(
            chunk_index=chunk_index,
            focus_mesh=focus_mesh,
            rest_mesh=rest_mesh,
            cl_data=ChunkClData(
                tool_vertices=tool_vertices,
                tool_axis=tuple(float(axis) for axis in operation.tool_axis),
                clearance_plane_height=float(operation.clearance_plane_height),
                # ponytail: chunk CL data keeps clipped tool positions only; add original feed/comment metadata if a caller needs exact record provenance.
                points=[position_to_record(position) for position in chunk_positions],
            ),
            stock_like_original_ids=stock_like_original_ids,
        )
        prepared_chunks.append(prepared_chunk)
        completed_progress_steps += 1
        if progress_callback:
            progress_callback(
                completed_progress_steps,
                total_progress_steps,
                f"Prepared chunk {chunk_index + 1} of {len(position_chunks)}.",
            )

        def report_segment_complete() -> None:
            nonlocal completed_progress_steps
            completed_progress_steps += 1
            if progress_callback:
                progress_callback(
                    completed_progress_steps,
                    total_progress_steps,
                    f"Processing chunk {chunk_index + 1} of {len(position_chunks)}.",
                )

        current_stock, _subtraction_seconds, _segment_count = simulate_manifold_by_moves(
            current_stock,
            tool_vertices,
            chunk_positions,
            context_prefix=f"chunk {chunk_index} stock",
            rotate_tool_with_path=rotate_tool_with_path,
            should_cancel=should_cancel,
            on_segment_complete=report_segment_complete,
        )
        completed_progress_steps = max(completed_progress_steps, chunk_target_progress)
        if progress_callback:
            progress_callback(
                completed_progress_steps,
                total_progress_steps,
                f"Finished chunk {chunk_index + 1} of {len(position_chunks)}.",
            )
        if SIMPLIFY_AFTER_EACH_CHUNK and chunk_index < len(position_chunks) - 1:
            current_stock = simplify_manifold_for_boolean(
                current_stock,
                context=f"recombined stock after chunk {chunk_index}",
            )

    return prepared_chunks, current_stock


def march_tool_positions(
    positions: list[np.ndarray],
    step_distance: float,
    angle_tolerance_degrees: float = DEFAULT_PATH_ANGLE_TOLERANCE_DEGREES,
) -> list[np.ndarray]:
    """March along a toolpath at fixed spacing, forcing earlier samples at sharp turns."""
    if not positions:
        return []
    if not math.isfinite(step_distance) or step_distance <= 0:
        raise ValueError("step_distance must be positive.")
    if not math.isfinite(angle_tolerance_degrees) or angle_tolerance_degrees < 0:
        raise ValueError("angle_tolerance_degrees must be non-negative.")

    marched = [np.asarray(positions[0], dtype=np.float64)]
    distance_since_sample = 0.0
    reference_direction: np.ndarray | None = None
    min_alignment = math.cos(math.radians(angle_tolerance_degrees))
    tolerance = 1e-9

    for index in range(1, len(positions)):
        start = np.asarray(positions[index - 1], dtype=np.float64)
        end = np.asarray(positions[index], dtype=np.float64)
        translation = end - start
        segment_length = float(np.linalg.norm(translation))

        if segment_length < tolerance:
            continue

        segment_direction = translation / segment_length
        if reference_direction is None:
            reference_direction = segment_direction
        else:
            alignment = float(np.clip(np.dot(reference_direction, segment_direction), -1.0, 1.0))
            if alignment < min_alignment:
                if not np.allclose(marched[-1], start, atol=tolerance, rtol=0.0):
                    marched.append(start)
                distance_since_sample = 0.0
                reference_direction = segment_direction

        segment_consumed = 0.0
        segment_remaining = segment_length

        while distance_since_sample + segment_remaining >= step_distance:
            distance_to_sample = max(step_distance - distance_since_sample, 0.0)
            segment_consumed += distance_to_sample
            interpolation = min(segment_consumed / segment_length, 1.0)
            sample = start + translation * interpolation
            if not np.allclose(marched[-1], sample, atol=tolerance, rtol=0.0):
                marched.append(sample)

            distance_since_sample = 0.0
            reference_direction = segment_direction
            segment_remaining = segment_length - segment_consumed
            if segment_remaining <= tolerance:
                segment_consumed = segment_length
                break

        distance_since_sample += segment_length - segment_consumed

    final_position = np.asarray(positions[-1], dtype=np.float64)
    if not np.allclose(marched[-1], final_position, atol=tolerance, rtol=0.0):
        marched.append(final_position)

    return marched


def resample_chunk_cl_data(
    chunk_cl_data: ChunkClData,
    step_distance: float,
    angle_tolerance_degrees: float = DEFAULT_PATH_ANGLE_TOLERANCE_DEGREES,
) -> list[PositionRecord3D]:
    sampled_positions = march_tool_positions(
        [record_to_position(point) for point in chunk_cl_data.points],
        step_distance,
        angle_tolerance_degrees,
    )
    return [position_to_record(position) for position in sampled_positions]


def coalesce_straight_tool_positions(
    positions: list[np.ndarray],
    straight_line_tolerance_degrees: float,
) -> list[np.ndarray]:
    if len(positions) <= 2:
        return positions[:]
    if not math.isfinite(straight_line_tolerance_degrees) or straight_line_tolerance_degrees < 0:
        raise ValueError("straight_line_tolerance_degrees must be non-negative.")

    coalesced = [np.asarray(position, dtype=np.float64) for position in positions[:2]]
    min_alignment = math.cos(math.radians(straight_line_tolerance_degrees))

    for next_position in positions[2:]:
        start = coalesced[-2]
        middle = coalesced[-1]
        end = np.asarray(next_position, dtype=np.float64)
        previous = middle - start
        current = end - middle
        previous_length = float(np.linalg.norm(previous))
        current_length = float(np.linalg.norm(current))

        if current_length < 1e-9:
            continue
        if previous_length < 1e-9:
            coalesced[-1] = end
            continue

        alignment = float(np.dot(previous, current) / (previous_length * current_length))
        if alignment >= min_alignment:
            coalesced[-1] = end
            continue

        coalesced.append(end)

    return coalesced


def simulate_chunk_focus_mesh(
    focus_mesh: Manifold,
    chunk_cl_data: ChunkClData,
    sampled_points: list[PositionRecord3D],
    point_index: int,
    *,
    context: str = "chunk focus simulation",
    straight_line_tolerance_degrees: float = DEFAULT_STRAIGHT_LINE_TOLERANCE_DEGREES,
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH,
    include_corner_rotation_sweeps: bool = DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS,
) -> Manifold:
    if not sampled_points:
        raise IndexError("sampled_points is empty")
    if point_index < 0 or point_index >= len(sampled_points):
        raise IndexError(f"point_index {point_index} is out of range for {len(sampled_points)} sampled points.")
    if point_index == 0:
        return focus_mesh

    tool_vertices = chunk_cl_data.tool_vertices
    sampled_positions = coalesce_straight_tool_positions(
        [record_to_position(point) for point in sampled_points[: point_index + 1]],
        straight_line_tolerance_degrees,
    )
    swept_manifolds: list[Manifold] = []
    previous_translation: np.ndarray | None = None
    previous_rotated_tool_vertices: np.ndarray | None = None

    for step in range(1, len(sampled_positions)):
        pos_a = sampled_positions[step - 1]
        pos_b = sampled_positions[step]
        translation = pos_b - pos_a
        if np.linalg.norm(translation) < 1e-9:
            continue

        sweep_rotation = tool_rotation_matrix(translation, rotate_tool_with_path=rotate_tool_with_path)
        rotated_tool_vertices = tool_vertices @ sweep_rotation.T

        if (
            rotate_tool_with_path
            and include_corner_rotation_sweeps
            and previous_translation is not None
            and previous_rotated_tool_vertices is not None
            and directions_form_non_collinear_turn(
                previous_translation,
                translation,
                straight_line_tolerance_degrees,
            )
        ):
            corner_vertices = previous_rotated_tool_vertices + pos_a[None, :]
            rotated_corner_vertices = rotated_tool_vertices + pos_a[None, :]
            swept_manifolds.append(
                swept_volume_manifold(
                    corner_vertices,
                    end_verts=rotated_corner_vertices,
                    context=f"{context} rotational sweep at corner {step - 1}",
                )
            )

        start_sweep_vertices = rotated_tool_vertices + pos_a[None, :]
        end_sweep_vertices = rotated_tool_vertices + pos_b[None, :]
        swept_manifolds.append(
            swept_volume_manifold(
                start_sweep_vertices,
                end_verts=end_sweep_vertices,
                context=f"{context} swept volume for segment {step}",
            )
        )
        previous_translation = translation
        previous_rotated_tool_vertices = rotated_tool_vertices

    if not swept_manifolds:
        return focus_mesh

    return boolean_manifolds(
        [focus_mesh, *swept_manifolds],
        OpType.Subtract,
        context=f"{context} subtraction through point {point_index}",
    )


def simulate_manifold_by_moves(
    manifold: Manifold,
    tool_vertices: np.ndarray,
    positions: list[np.ndarray],
    *,
    context_prefix: str,
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH,
    should_cancel: Callable[[], bool] | None = None,
    on_segment_complete: Callable[[], None] | None = None,
) -> tuple[Manifold, float, int]:
    current = manifold
    subtraction_seconds = 0.0
    applied_segments = 0

    for step in range(1, len(positions)):
        if should_cancel and should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        pos_a = positions[step - 1]
        pos_b = positions[step]
        translation = pos_b - pos_a
        if np.linalg.norm(translation) < 1e-9:
            continue

        sweep_rotation = tool_rotation_matrix(translation, rotate_tool_with_path=rotate_tool_with_path)
        rotated_tool_vertices = tool_vertices @ sweep_rotation.T
        start_sweep_vertices = rotated_tool_vertices + pos_a[None, :]
        end_sweep_vertices = rotated_tool_vertices + pos_b[None, :]
        swept_manifold = swept_volume_manifold(
            start_sweep_vertices,
            end_verts=end_sweep_vertices,
            context=f"{context_prefix} swept volume for segment {step}",
        )

        subtraction_start = time.perf_counter()
        current = ensure_no_manifold_error(
            current - swept_manifold,
            context=f"{context_prefix} subtraction at segment {step}",
        )
        subtraction_seconds += time.perf_counter() - subtraction_start
        applied_segments += 1
        if on_segment_complete:
            on_segment_complete()

    return current, subtraction_seconds, applied_segments


def manifold_to_simplified_glb(
    manifold: Manifold,
    *,
    context: str,
    stock_like_original_ids: set[int] | None = None,
) -> bytes:
    if stock_like_original_ids is None:
        vertices, faces = manifold_to_mesh(manifold, context=context)
        reduced_vertices, reduced_faces = simplify_planar_mesh(vertices, faces)
        return maybe_compress_glb(write_glb(reduced_vertices, reduced_faces), context=context)

    vertices, faces, face_original_ids = manifold_to_labeled_mesh(manifold, context=context)
    face_is_cut = ~np.isin(face_original_ids, list(stock_like_original_ids))
    reduced_vertices, reduced_faces, reduced_face_is_cut = simplify_labeled_mesh(
        vertices,
        faces,
        face_is_cut,
    )
    return maybe_compress_glb(
        write_glb(reduced_vertices, reduced_faces, face_is_cut=reduced_face_is_cut),
        context=context,
    )


def combine_glb_meshes(mesh_bytes_list: list[bytes]) -> trimesh.Trimesh:
    meshes = []
    for mesh_bytes in mesh_bytes_list:
        mesh = trimesh.load(io.BytesIO(mesh_bytes), file_type="glb", force="mesh")
        if mesh is None or mesh.is_empty:
            continue
        meshes.append(mesh)

    if not meshes:
        return trimesh.Trimesh(vertices=np.zeros((0, 3)), faces=np.zeros((0, 3), dtype=np.int32), process=False)

    if len(meshes) == 1:
        return meshes[0]

    return trimesh.util.concatenate(meshes)


def simulate_swept_milling_frames(
    mesh_input: bytes | str,
    operation: OperationRecord3D,
    *,
    max_sim_distance: float = DEFAULT_MAX_SIM_DISTANCE,
    chunk_padding: tuple[float, float, float] = DEFAULT_CHUNK_PADDING,
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH,
    progress_callback: Callable[[int, int, str], None] | None = None,
    should_cancel: Callable[[], bool] | None = None,
) -> tuple[bytes, list[SimulatedChunk], list[SimulatedMeshFrame]]:
    tool_vertices, tool_faces = build_tool_mesh_vertices_faces(operation.tool)
    tool_mesh_glb = build_tool_mesh_glb_from_tool(operation.tool)

    stock_original_id = Manifold.reserve_ids(1)
    chunk_boundary_original_id = Manifold.reserve_ids(1)
    stock_like_original_ids = {stock_original_id, chunk_boundary_original_id}

    stock_min, stock_max = load_stl_bounds(load_stl_bytes(mesh_input))
    stock_vertices, stock_faces = build_box_mesh(stock_min, stock_max)
    current_stock = mesh_to_manifold(
        stock_vertices,
        stock_faces,
        context="stock mesh import",
        original_id=stock_original_id,
    )
    original_positions = load_tool_positions(operation)
    (
        contact_position_sequences,
        retained_contact_segments,
        skipped_non_contact_segments,
        trimmed_contact_segments,
    ) = filter_contact_position_sequences(
        original_positions,
        tool_vertices,
        stock_min,
        stock_max,
    )
    position_chunks, chunk_seed_position_count = build_position_chunks(contact_position_sequences, max_sim_distance)
    filtered_position_count = sum(len(sequence) for sequence in contact_position_sequences)
    subdivided_position_chunks = [
        march_tool_positions(chunk_positions, SIM_STEPDISTANCE)
        for chunk_positions in position_chunks
    ]
    total_stock_segments = sum(max(len(chunk_positions) - 1, 0) for chunk_positions in position_chunks)
    total_animation_segments = sum(
        max(len(chunk_subdivided_positions) - 1, 0)
        for chunk_subdivided_positions in subdivided_position_chunks
    )
    total_progress_steps = max(2 + (len(position_chunks) * 2) + total_stock_segments + total_animation_segments, 1)
    progress_step = 0

    def report_progress(message: str) -> None:
        if progress_callback:
            progress_callback(progress_step, total_progress_steps, message)

    def advance_progress(message: str) -> None:
        nonlocal progress_step
        progress_step = min(progress_step + 1, total_progress_steps)
        report_progress(message)

    if should_cancel and should_cancel():
        raise SimulationCancelledError("Simulation generation cancelled.")

    report_progress("Preparing simulation...")
    frames: list[SimulatedMeshFrame] = []
    chunks: list[SimulatedChunk] = []

    print(f"[simulate/swept] Stock bounds: min={stock_min.tolist()} max={stock_max.tolist()}")
    print(
        f"[simulate/swept] Tool mesh: vertices={len(tool_vertices)} faces={len(tool_faces)}"
    )
    print(f"[simulate/swept] Original positions: {len(original_positions)}")
    print(f"[simulate/swept] Original swept segments: {max(len(original_positions) - 1, 0)}")
    print(f"[simulate/swept] Contact sequences: {len(contact_position_sequences)}")
    print(f"[simulate/swept] Retained contact segments: {retained_contact_segments}")
    print(f"[simulate/swept] Trimmed contact-transition segments: {trimmed_contact_segments}")
    print(f"[simulate/swept] Skipped non-contact segments: {skipped_non_contact_segments}")
    print(f"[simulate/swept] Filtered positions: {filtered_position_count}")
    print(f"[simulate/swept] Chunk seed positions: {chunk_seed_position_count}")
    print(f"[simulate/swept] Chunk count: {len(position_chunks)}")
    print(f"[simulate/swept] Max chunk travel distance: {max_sim_distance}")
    print(f"[simulate/swept] Chunk padding: {list(chunk_padding)}")
    print(f"[simulate/swept] Segment subdivision distance: {SIM_STEPDISTANCE}")
    if SIMPLIFY_AFTER_EACH_CHUNK:
        print("[simulate/swept] Boolean simplification: after each chunk")
    else:
        print("[simulate/swept] Boolean simplification: disabled")

    stock_subtraction_seconds = 0.0
    animation_subtraction_seconds = 0.0

    if not position_chunks:
        advance_progress("Extracting initial stock mesh...")
        simplified_stock_bytes = manifold_to_simplified_glb(
            current_stock,
            context="extracting initial stock mesh",
            stock_like_original_ids=stock_like_original_ids,
        )
        chunks.append(
            SimulatedChunk(
                cached_mesh_bytes=simplified_stock_bytes,
                frame_start_index=0,
                frame_end_index=0,
            )
        )
        frames.append(
            SimulatedMeshFrame(
                active_mesh_bytes=write_glb(
                    np.zeros((0, 3), dtype=np.float64),
                    np.zeros((0, 3), dtype=np.int32),
                ),
                tool_position=PositionRecord3D(x=0.0, y=0.0, z=0.0),
                chunk_index=0,
            )
        )
        advance_progress("Simulation frames ready.")
        return tool_mesh_glb, chunks, frames

    initial_non_contact_frame: SimulatedMeshFrame | None = None

    for chunk_index, chunk_positions in enumerate(position_chunks):
        if should_cancel and should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        chunk_started_at = time.perf_counter()
        chunk_animation_subtraction_started_at = animation_subtraction_seconds
        chunk_start_stock = current_stock
        chunk_bounds_min, chunk_bounds_max = toolpath_chunk_bounds(
            tool_vertices,
            chunk_positions,
            chunk_padding,
        )
        chunk_box_vertices, chunk_box_faces = build_box_mesh(chunk_bounds_min, chunk_bounds_max)
        chunk_box_manifold = mesh_to_manifold(
            chunk_box_vertices,
            chunk_box_faces,
            context=f"chunk {chunk_index} bounds",
            original_id=chunk_boundary_original_id,
        )

        chunk_interest = boolean_manifolds(
            [chunk_start_stock, chunk_box_manifold],
            OpType.Intersect,
            context=f"chunk {chunk_index} interest intersection",
        )
        chunk_cached = ensure_no_manifold_error(
            chunk_start_stock - chunk_box_manifold,
            context=f"chunk {chunk_index} cached subtraction",
        )
        chunk_cached_mesh_bytes = manifold_to_simplified_glb(
            chunk_cached,
            context=f"extracting cached mesh for chunk {chunk_index}",
            stock_like_original_ids=stock_like_original_ids,
        )
        advance_progress(
            f"Processing chunk {chunk_index + 1} of {len(position_chunks)}..."
        )
        chunk_final_stock, chunk_stock_subtraction_seconds, chunk_fast_segment_count = simulate_manifold_by_moves(
            chunk_start_stock,
            tool_vertices,
            chunk_positions,
            context_prefix=f"chunk {chunk_index} stock",
            rotate_tool_with_path=rotate_tool_with_path,
            should_cancel=should_cancel,
            on_segment_complete=lambda: advance_progress(
                f"Processing chunk {chunk_index + 1} of {len(position_chunks)}..."
            ),
        )
        stock_subtraction_seconds += chunk_stock_subtraction_seconds

        chunk_frame_start_index = len(frames)
        chunk_local_current = chunk_interest
        chunk_subdivided_positions = subdivided_position_chunks[chunk_index]
        if initial_non_contact_frame is None and chunk_subdivided_positions:
            initial_non_contact_frame = SimulatedMeshFrame(
                active_mesh_bytes=manifold_to_simplified_glb(
                    chunk_interest,
                    context=f"extracting initial active mesh for chunk {chunk_index}",
                    stock_like_original_ids=stock_like_original_ids,
                ),
                tool_position=position_to_record(chunk_subdivided_positions[0]),
                chunk_index=chunk_index,
            )
        chunk_total_segments = max(len(chunk_subdivided_positions) - 1, 0)
        buffered_distance = 0.0

        print(
            f"[simulate/swept] Chunk {chunk_index + 1}/{len(position_chunks)}: "
            f"positions={len(chunk_positions)} fast_segments={chunk_fast_segment_count} "
            f"subdivided={len(chunk_subdivided_positions)}"
        )

        for step in range(1, len(chunk_subdivided_positions)):
            if should_cancel and should_cancel():
                raise SimulationCancelledError("Simulation generation cancelled.")

            pos_a = chunk_subdivided_positions[step - 1]
            pos_b = chunk_subdivided_positions[step]
            translation = pos_b - pos_a
            segment_length = float(np.linalg.norm(translation))
            if segment_length < 1e-9:
                print(
                    f"[simulate/swept] Chunk {chunk_index + 1}/{len(position_chunks)} "
                    f"segment {step}/{chunk_total_segments}: skipped zero-length segment"
                )
                continue

            sweep_rotation = tool_rotation_matrix(
                translation,
                rotate_tool_with_path=rotate_tool_with_path,
            )
            rotated_tool_vertices = tool_vertices @ sweep_rotation.T
            start_sweep_vertices = rotated_tool_vertices + pos_a[None, :]
            end_sweep_vertices = rotated_tool_vertices + pos_b[None, :]
            swept_manifold = swept_volume_manifold(
                start_sweep_vertices,
                end_verts=end_sweep_vertices,
                context=f"chunk {chunk_index} local swept volume for segment {step}",
            )

            subtraction_start = time.perf_counter()
            chunk_local_current = ensure_no_manifold_error(
                chunk_local_current - swept_manifold,
                context=f"chunk {chunk_index} local subtraction at segment {step}",
            )
            subtraction_elapsed = time.perf_counter() - subtraction_start
            animation_subtraction_seconds += subtraction_elapsed

            advance_progress(
                f"Rendering chunk {chunk_index + 1} of {len(position_chunks)}..."
            )
            buffered_distance += segment_length
            is_final_segment = step == len(chunk_subdivided_positions) - 1
            should_buffer_frame = buffered_distance >= SIM_STEPDISTANCE or is_final_segment

            if not should_buffer_frame:
                continue

            frames.append(
                SimulatedMeshFrame(
                    active_mesh_bytes=manifold_to_simplified_glb(
                        chunk_local_current,
                        context=f"extracting active mesh for chunk {chunk_index} segment {step}",
                        stock_like_original_ids=stock_like_original_ids,
                    ),
                    tool_position=position_to_record(pos_b),
                    chunk_index=chunk_index,
                )
            )
            buffered_distance = 0.0

        if len(frames) == chunk_frame_start_index:
            fallback_position = chunk_subdivided_positions[0] if chunk_subdivided_positions else chunk_positions[0]
            frames.append(
                SimulatedMeshFrame(
                    active_mesh_bytes=manifold_to_simplified_glb(
                        chunk_local_current,
                        context=f"extracting fallback active mesh for chunk {chunk_index}",
                        stock_like_original_ids=stock_like_original_ids,
                    ),
                    tool_position=position_to_record(fallback_position),
                    chunk_index=chunk_index,
                )
            )

        chunk_frame_end_index = len(frames) - 1
        chunks.append(
            SimulatedChunk(
                cached_mesh_bytes=chunk_cached_mesh_bytes,
                frame_start_index=chunk_frame_start_index,
                frame_end_index=chunk_frame_end_index,
            )
        )

        chunk_elapsed_seconds = time.perf_counter() - chunk_started_at
        chunk_animation_subtraction_seconds = (
            animation_subtraction_seconds - chunk_animation_subtraction_started_at
        )
        print(
            f"[simulate/swept] Chunk {chunk_index + 1}/{len(position_chunks)} done: "
            f"elapsed={chunk_elapsed_seconds:.3f}s "
            f"stock={chunk_stock_subtraction_seconds:.3f}s "
            f"animation={chunk_animation_subtraction_seconds:.3f}s "
            f"frames={len(frames) - chunk_frame_start_index}"
        )

        advance_progress(
            f"Finished chunk {chunk_index + 1} of {len(position_chunks)}."
        )
        current_stock = chunk_final_stock
        if SIMPLIFY_AFTER_EACH_CHUNK and chunk_index < len(position_chunks) - 1:
            current_stock = simplify_manifold_for_boolean(
                current_stock,
                context=f"recombined stock after chunk {chunk_index}",
            )

    frames = build_animation_frames(
        frames,
        operation,
        initial_non_contact_frame,
        rapid_frame_step_scale=DEFAULT_RAPID_FRAME_STEP_SCALE,
    )
    advance_progress("Finalizing simulation frames...")

    print(f"[simulate/swept] Total stock subtraction time: {stock_subtraction_seconds:.3f}s")
    print(f"[simulate/swept] Total animation subtraction time: {animation_subtraction_seconds:.3f}s")
    print(f"[simulate/swept] Buffered {len(frames)} simulation frames across {len(chunks)} chunks")
    return tool_mesh_glb, chunks, frames


def simulate_swept_milling_stl(mesh_input: bytes | str, operation: OperationRecord3D) -> bytes:
    _tool_mesh_bytes, chunks, frames = simulate_swept_milling_frames(mesh_input, operation)
    final_frame = frames[-1]
    final_chunk = chunks[final_frame.chunk_index]
    final_mesh = combine_glb_meshes(
        [
            final_chunk.cached_mesh_bytes,
            final_frame.active_mesh_bytes,
        ]
    )
    return final_mesh.export(file_type="stl")


def simulate_swept_milling(mesh_data_url: bytes | str, operation: OperationRecord3D) -> str:
    return encode_mesh_data_url(simulate_swept_milling_stl(mesh_data_url, operation))
