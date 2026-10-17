import io
import json
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Event, Lock, Thread
from uuid import uuid4

import numpy as np
import rhino3dm
import trimesh
from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import ValidationError
from trimesh.proximity import ProximityQuery

from opencam.schemas.cl_data import OperationRecord3D, PositionRecord3D
from opencam.services.mesh_cache import get_mesh_cache
from opencam.services.tool_mesh import build_tool_mesh_glb_from_tool
from opencam.services.toolpath_run_logs import ensure_logged_cl, log_simulation_frames
from opencam.simulation.models import (
    SimulationChunkMapping,
    SimulationFrameMapping,
    SweptSimulationComparisonResponse,
    SweptSimulationResponse,
    SweptSimulationStartResponse,
    SweptSimulationStatusResponse,
)
from opencam.simulation.swept_volume import (
    DEFAULT_CHUNK_STEP_DISTANCE,
    DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS,
    DEFAULT_MAX_SIM_DISTANCE,
    DEFAULT_RAPID_FRAME_STEP_SCALE,
    DEFAULT_ROTATE_TOOL_WITH_PATH,
    PreparedSimulationChunk,
    SimulatedChunk,
    SimulationCancelledError,
    manifold_to_simplified_glb,
    map_positions_to_operation_progress,
    map_progress_to_cl_record_indices,
    maybe_compress_glb,
    positions_match,
    prepare_simulation_chunks,
    resample_chunk_cl_data,
    sample_operation_points_with_progress,
    simulate_chunk_focus_mesh,
    write_glb,
)

router = APIRouter()

DISPLAY_REMESH_TARGET_EDGE_LENGTH = 0.5
DISPLAY_REMESH_ITERATIONS = 10
COMPARISON_CLOSE_DISTANCE = 0.1
COMPARISON_FAR_DISTANCE = 0.25
COMPARISON_GREEN_RGBA = np.array([0, 255, 0, 255], dtype=np.uint8)
COMPARISON_TEAL_RGBA = np.array([32, 138, 155, 255], dtype=np.uint8)
COMPARISON_BLUE_RGBA = np.array([0, 0, 255, 255], dtype=np.uint8)

# Global cap on cached in-process (active) meshes across all chunks. LRU-evicted.
ACTIVE_MESH_CACHE_LIMIT = 400


def _comparison_debug(label: str, started_at: float, **details: object) -> None:
    parts = [f"{key}={value}" for key, value in details.items()]
    suffix = f" {' '.join(parts)}" if parts else ""
    print(f"[simulate/comparison] {label} elapsed={time.perf_counter() - started_at:.3f}s{suffix}")


@dataclass(frozen=True)
class PreparedSimulationFrame:
    chunk_index: int
    point_index: int
    tool_position: PositionRecord3D
    chunk_step_count: int = 0
    active_mesh_index: int | None = None
    cl_record_index: int = 0


@dataclass
class BufferedSimulationResult:
    tool_mesh_bytes: bytes
    chunks: list[SimulatedChunk]
    prepared_chunks: list[PreparedSimulationChunk]
    operation: OperationRecord3D
    frames: list[PreparedSimulationFrame]
    frame_step_distance: float
    rapid_frame_step_scale: float = 1.0
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH
    include_corner_rotation_sweeps: bool = DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS
    stock_mesh_bytes: bytes = b""
    final_mesh_bytes: bytes = b""
    # ponytail: cache grows with viewed frames; add LRU eviction if live simulation memory proves material.
    active_mesh_cache: OrderedDict[tuple[int, int], bytes] = field(default_factory=OrderedDict)
    active_mesh_cache_lock: Lock = field(default_factory=Lock)
    comparison_meshes: tuple[bytes, bytes] | None = None
    comparison_mesh_lock: Lock = field(default_factory=Lock)
    comparison_mesh_generation: int = 0


@dataclass
class SimulationTask:
    status: str = "queued"
    progress_current: int = 0
    progress_total: int = 1
    message: str | None = None
    error_detail: str | None = None
    result: SweptSimulationResponse | None = None
    cancel_event: Event = field(default_factory=Event)


SIMULATION_FRAME_BUFFER: dict[str, BufferedSimulationResult] = {}
SIMULATION_FRAME_BUFFER_LOCK = Lock()
SIMULATION_TASKS: dict[str, SimulationTask] = {}
SIMULATION_TASKS_LOCK = Lock()


def _tool_mesh_url(simulation_id: str) -> str:
    return f"/simulate/{simulation_id}/tool-mesh.glb"


def _chunk_cached_mesh_url(simulation_id: str, chunk_index: int) -> str:
    return f"/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb"


def _final_mesh_url(simulation_id: str, version: int) -> str:
    # Content-versioned so a browser can cache aggressively but never serve a
    # stale final mesh across a regeneration/rebuild under the same id.
    return f"/simulate/{simulation_id}/final-mesh.glb?v={version}"


def _comparison_cached_mesh_url(simulation_id: str, version: int) -> str:
    return f"/simulate/{simulation_id}/comparison/cached-mesh.glb?v={version}"


def _comparison_active_mesh_url(simulation_id: str, version: int) -> str:
    return f"/simulate/{simulation_id}/comparison/active-mesh.glb?v={version}"


def _load_trimesh_from_bytes(mesh_bytes: bytes, file_type: str) -> trimesh.Trimesh:
    loaded = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    if loaded is None or getattr(loaded, "is_empty", False):
        raise ValueError("Mesh asset is empty or unreadable.")
    if not isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.util.concatenate(tuple(loaded.dump()))
    if len(loaded.vertices) == 0 or len(loaded.faces) == 0:
        raise ValueError("Mesh asset contains no faces.")
    return loaded


def _remesh_visualization_mesh(
    mesh_bytes: bytes,
    target_edge_length: float = DISPLAY_REMESH_TARGET_EDGE_LENGTH,
) -> bytes:
    started_at = time.perf_counter()
    try:
        import pymeshlab

        source_mesh = _load_trimesh_from_bytes(mesh_bytes, file_type="glb")
        meshset = pymeshlab.MeshSet()
        meshset.add_mesh(
            pymeshlab.Mesh(
                vertex_matrix=np.ascontiguousarray(source_mesh.vertices, dtype=np.float64),
                face_matrix=np.ascontiguousarray(source_mesh.faces, dtype=np.int32),
            ),
            "comparison-mesh",
        )
        meshset.meshing_isotropic_explicit_remeshing(
            iterations=DISPLAY_REMESH_ITERATIONS,
            adaptive=False,
            targetlen=pymeshlab.PureValue(float(target_edge_length)),
            checksurfdist=True,
            maxsurfdist=pymeshlab.PureValue(float(target_edge_length) * 0.5),
        )
        remeshed = meshset.current_mesh()
        vertices = np.asarray(remeshed.vertex_matrix(), dtype=np.float64)
        faces = np.asarray(remeshed.face_matrix(), dtype=np.int64)
        if len(vertices) == 0 or len(faces) == 0:
            _comparison_debug(
                "remesh-empty",
                started_at,
                input_vertices=len(source_mesh.vertices),
                input_faces=len(source_mesh.faces),
            )
            return mesh_bytes
        remeshed_bytes = trimesh.Trimesh(vertices=vertices, faces=faces, process=False).export(file_type="glb")
        _comparison_debug(
            "remesh",
            started_at,
            input_vertices=len(source_mesh.vertices),
            input_faces=len(source_mesh.faces),
            output_vertices=len(vertices),
            output_faces=len(faces),
            output_bytes=len(remeshed_bytes),
        )
        return maybe_compress_glb(remeshed_bytes, context="comparison remesh")
    except Exception as exc:  # comparison is optional display work
        print(f"[simulate/comparison] remesh fallback after {time.perf_counter() - started_at:.3f}s: {exc}")
        return mesh_bytes


def _comparison_vertex_colors(distances: np.ndarray) -> np.ndarray:
    values = np.nan_to_num(
        np.abs(np.asarray(distances, dtype=np.float64)),
        nan=COMPARISON_FAR_DISTANCE,
        posinf=COMPARISON_FAR_DISTANCE,
    )
    midpoint = (COMPARISON_CLOSE_DISTANCE + COMPARISON_FAR_DISTANCE) / 2.0
    colors = np.empty((len(values), 4), dtype=np.float64)

    low_mask = values <= midpoint
    low_blend = np.clip((values[low_mask] - COMPARISON_CLOSE_DISTANCE) / (midpoint - COMPARISON_CLOSE_DISTANCE), 0.0, 1.0).reshape(-1, 1)
    colors[low_mask] = (1.0 - low_blend) * COMPARISON_GREEN_RGBA + low_blend * COMPARISON_TEAL_RGBA

    high_mask = ~low_mask
    high_blend = np.clip((values[high_mask] - midpoint) / (COMPARISON_FAR_DISTANCE - midpoint), 0.0, 1.0).reshape(-1, 1)
    colors[high_mask] = (1.0 - high_blend) * COMPARISON_TEAL_RGBA + high_blend * COMPARISON_BLUE_RGBA

    return np.rint(colors).astype(np.uint8)


def _apply_comparison_distance_colors(mesh_bytes: bytes, stock_mesh_bytes: bytes) -> bytes:
    started_at = time.perf_counter()
    try:
        mesh = _load_trimesh_from_bytes(mesh_bytes, file_type="glb")
        stock_mesh = _load_trimesh_from_bytes(stock_mesh_bytes, file_type="stl")
        query = ProximityQuery(stock_mesh)
        vertices = np.asarray(mesh.vertices, dtype=np.float64)
        if stock_mesh.is_watertight:
            distances = query.signed_distance(vertices)
        else:
            _closest, distances, _triangle_ids = query.on_surface(vertices)
        mesh.visual.vertex_colors = _comparison_vertex_colors(distances)
        colored_mesh_bytes = mesh.export(file_type="glb")
        _comparison_debug(
            "colorize",
            started_at,
            vertices=len(vertices),
            watertight=stock_mesh.is_watertight,
            output_bytes=len(colored_mesh_bytes),
        )
        return colored_mesh_bytes
    except Exception as exc:  # comparison colors should not hide otherwise usable meshes
        print(f"[simulate/comparison] color fallback after {time.perf_counter() - started_at:.3f}s: {exc}")
        return mesh_bytes


def _build_comparison_mesh_bytes(
    simulation_mesh: bytes,
    reference_mesh: bytes,
) -> tuple[bytes, bytes]:
    # Colors the final simulation mesh by deviation from the uploaded part mesh.
    # Returned as a pair so both comparison endpoints can serve it without a
    # schema/frontend change; the two are identical until the UI collapses to a
    # single comparison layer.
    colored = _apply_comparison_distance_colors(_remesh_visualization_mesh(simulation_mesh), reference_mesh)
    return (colored, colored)


def _comparison_meshes(simulation: BufferedSimulationResult) -> tuple[bytes, bytes]:
    # Called by the comparison endpoints, which already hold
    # SIMULATION_FRAME_BUFFER_LOCK. The comparison is static (final sim vs part),
    # so it no longer depends on frames.
    started_at = time.perf_counter()
    with simulation.comparison_mesh_lock:
        if simulation.comparison_meshes is not None:
            _comparison_debug(
                "build-cache-hit",
                started_at,
                output_bytes=len(simulation.comparison_meshes[0]),
            )
            return simulation.comparison_meshes

    comparison_meshes = _build_comparison_mesh_bytes(
        simulation.final_mesh_bytes,
        simulation.stock_mesh_bytes,
    )
    with simulation.comparison_mesh_lock:
        simulation.comparison_meshes = comparison_meshes
    _comparison_debug(
        "build-cache-miss",
        started_at,
        output_bytes=len(comparison_meshes[0]),
    )
    return comparison_meshes


def _run_comparison_mesh_build(simulation: BufferedSimulationResult) -> None:
    # Warms the comparison cache off the request path. Snapshots cheap inputs under
    # the buffer lock, then runs the expensive remesh/colorize unlocked so endpoints
    # stay responsive. A generation token discards results made stale by a resample.
    started_at = time.perf_counter()
    try:
        with SIMULATION_FRAME_BUFFER_LOCK:
            generation = simulation.comparison_mesh_generation
            if simulation.comparison_meshes is not None:
                _comparison_debug("build-skipped-warm", started_at)
                return
            simulation_mesh = simulation.final_mesh_bytes
            reference_mesh = simulation.stock_mesh_bytes

        comparison_meshes = _build_comparison_mesh_bytes(simulation_mesh, reference_mesh)

        with simulation.comparison_mesh_lock:
            if simulation.comparison_mesh_generation != generation:
                _comparison_debug("build-discarded-stale", started_at, generation=generation)
                return
            simulation.comparison_meshes = comparison_meshes
        _comparison_debug(
            "build-background",
            started_at,
            output_bytes=len(comparison_meshes[0]),
        )
    except Exception as exc:  # background warming is best-effort; endpoints rebuild on demand
        print(f"[simulate/comparison] background build failed after {time.perf_counter() - started_at:.3f}s: {exc}")


def _rhino_mesh_payload_from_bytes(mesh_bytes: bytes, file_type: str = "glb") -> dict:
    mesh = _load_trimesh_from_bytes(mesh_bytes, file_type=file_type)
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)

    vertex_colors = None
    visual = getattr(mesh, "visual", None)
    if visual is not None and hasattr(visual, "vertex_colors"):
        candidate_colors = np.asarray(visual.vertex_colors, dtype=np.uint8)
        if (
            candidate_colors.ndim == 2
            and candidate_colors.shape[0] == len(vertices)
            and candidate_colors.shape[1] >= 3
        ):
            vertex_colors = candidate_colors[:, :3]

    rhino_mesh = rhino3dm.Mesh()
    for vertex_index, (x, y, z) in enumerate(vertices[:, :3]):
        rhino_mesh.Vertices.Add(float(x), float(y), float(z))
        if vertex_colors is not None:
            red, green, blue = vertex_colors[vertex_index]
            rhino_mesh.VertexColors.Add(int(red), int(green), int(blue))

    for face in faces:
        if len(face) == 3:
            rhino_mesh.Faces.AddFace(int(face[0]), int(face[1]), int(face[2]))
        elif len(face) == 4:
            rhino_mesh.Faces.AddFace(int(face[0]), int(face[1]), int(face[2]), int(face[3]))

    if rhino_mesh.Faces.Count == 0:
        raise ValueError("Converted Rhino mesh contains no faces.")

    rhino_mesh.Normals.ComputeNormals()
    rhino_mesh.Compact()
    if not rhino_mesh.IsValid:
        raise ValueError("Converted Rhino mesh is invalid.")
    return rhino_mesh.Encode()


def _rhino_mesh_response(mesh_bytes: bytes) -> Response:
    payload = _rhino_mesh_payload_from_bytes(mesh_bytes, file_type="glb")
    return Response(
        content=json.dumps(payload, separators=(",", ":")),
        media_type="application/json",
    )


def _simulation_chunk_mappings(
    simulation_id: str,
    simulation: BufferedSimulationResult,
) -> list[SimulationChunkMapping]:
    # Group the interleaved timeline into the chunk tree. Frames are ordered and
    # chunk_index is non-decreasing, so consecutive runs form each chunk's frame
    # list (contact frames plus trailing travel attributed to this chunk).
    chunks: list[SimulationChunkMapping] = []
    current_chunk_index: int | None = None
    current_frames: list[SimulationFrameMapping] = []
    for frame in simulation.frames:
        if current_chunk_index is not None and frame.chunk_index != current_chunk_index:
            chunks.append(
                SimulationChunkMapping(
                    cached_mesh_url=_chunk_cached_mesh_url(simulation_id, current_chunk_index),
                    frames=current_frames,
                )
            )
            current_frames = []
        current_chunk_index = frame.chunk_index
        current_frames.append(
            SimulationFrameMapping(
                tool_position=frame.tool_position,
                active_mesh_index=frame.active_mesh_index if frame.active_mesh_index is not None else frame.point_index,
                cl_record_index=frame.cl_record_index,
            )
        )
    if current_chunk_index is not None:
        chunks.append(
            SimulationChunkMapping(
                cached_mesh_url=_chunk_cached_mesh_url(simulation_id, current_chunk_index),
                frames=current_frames,
            )
        )
    return chunks


def _simulation_response(
    simulation_id: str,
    simulation: BufferedSimulationResult,
) -> SweptSimulationResponse:
    return SweptSimulationResponse(
        simulation_id=simulation_id,
        frame_count=len(simulation.frames),
        chunk_count=len(simulation.chunks),
        tool_mesh_url=_tool_mesh_url(simulation_id),
        final_mesh_url=_final_mesh_url(simulation_id, len(simulation.final_mesh_bytes)),
        chunks=_simulation_chunk_mappings(simulation_id, simulation),
    )


def _get_buffered_simulation(simulation_id: str) -> BufferedSimulationResult:
    simulation = SIMULATION_FRAME_BUFFER.get(simulation_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation result not found.")
    return simulation


def _get_buffered_chunk(simulation: BufferedSimulationResult, chunk_index: int) -> SimulatedChunk:
    if chunk_index < 0 or chunk_index >= len(simulation.chunks):
        raise HTTPException(status_code=404, detail="Simulation chunk not found.")
    return simulation.chunks[chunk_index]


def _build_contact_frames(
    prepared_chunks: list[PreparedSimulationChunk],
    frame_step_distance: float,
) -> list[PreparedSimulationFrame]:
    frames: list[PreparedSimulationFrame] = []

    for prepared_chunk in prepared_chunks:
        sampled_points = resample_chunk_cl_data(prepared_chunk.cl_data, frame_step_distance)

        if sampled_points:
            chunk_step_count = len(sampled_points)
            for point_index, point in enumerate(sampled_points):
                frames.append(
                    PreparedSimulationFrame(
                        chunk_index=prepared_chunk.chunk_index,
                        point_index=point_index,
                        tool_position=point,
                        chunk_step_count=chunk_step_count,
                        active_mesh_index=point_index,
                    )
                )
            continue

        fallback_position = prepared_chunk.cl_data.points[0] if prepared_chunk.cl_data.points else PositionRecord3D(x=0.0, y=0.0, z=0.0)
        frames.append(
            PreparedSimulationFrame(
                chunk_index=prepared_chunk.chunk_index,
                point_index=-1,
                tool_position=fallback_position,
                chunk_step_count=0,
                active_mesh_index=-1,
            )
        )

    return frames


def _build_animation_frames(
    mesh_frames: list[PreparedSimulationFrame],
    operation: OperationRecord3D,
    frame_step_distance: float,
    rapid_frame_step_scale: float = 1.0,
) -> list[PreparedSimulationFrame]:
    sampled_points = sample_operation_points_with_progress(
        operation,
        frame_step_distance,
        rapid_frame_step_scale=rapid_frame_step_scale,
    )
    if not mesh_frames or not sampled_points:
        return mesh_frames

    cl_indices = map_progress_to_cl_record_indices(
        operation, [progress for progress, _position in sampled_points]
    )
    mesh_frame_progresses = map_positions_to_operation_progress(
        operation,
        [frame.tool_position for frame in mesh_frames],
    )
    if len(mesh_frame_progresses) != len(mesh_frames):
        return mesh_frames

    current_mesh_frame = PreparedSimulationFrame(
        chunk_index=mesh_frames[0].chunk_index,
        point_index=-1,
        tool_position=sampled_points[0][1],
        chunk_step_count=mesh_frames[0].chunk_step_count,
        active_mesh_index=-1,
    )
    mesh_frame_index = 0
    animation_frames: list[PreparedSimulationFrame] = []

    for (progress, position), cl_record_index in zip(sampled_points, cl_indices):
        while (
            mesh_frame_index < len(mesh_frames)
            and mesh_frame_progresses[mesh_frame_index] <= progress + 1e-6
        ):
            current_mesh_frame = mesh_frames[mesh_frame_index]
            mesh_frame_index += 1

        next_frame = PreparedSimulationFrame(
            chunk_index=current_mesh_frame.chunk_index,
            point_index=current_mesh_frame.point_index,
            tool_position=position,
            chunk_step_count=current_mesh_frame.chunk_step_count,
            active_mesh_index=current_mesh_frame.active_mesh_index,
            cl_record_index=cl_record_index,
        )
        if (
            animation_frames
            and animation_frames[-1].chunk_index == next_frame.chunk_index
            and animation_frames[-1].point_index == next_frame.point_index
            and positions_match(animation_frames[-1].tool_position, next_frame.tool_position)
        ):
            continue

        animation_frames.append(next_frame)

    return animation_frames


def _build_buffered_simulation(
    mesh_bytes: bytes,
    operation: OperationRecord3D,
    *,
    chunk_padding: tuple[float, float, float],
    chunk_step_distance: float,
    rotate_tool_with_path: bool,
    include_corner_rotation_sweeps: bool,
    should_cancel: Callable[[], bool] | None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> BufferedSimulationResult:
    def report_prepare_progress(current: int, total: int, message: str) -> None:
        if progress_callback:
            progress_callback(round((current / max(total, 1)) * 85), message)

    frame_step_distance = chunk_step_distance
    rapid_frame_step_scale = DEFAULT_RAPID_FRAME_STEP_SCALE

    prepared_chunks, final_stock_manifold = prepare_simulation_chunks(
        mesh_bytes,
        operation,
        max_sim_distance=DEFAULT_MAX_SIM_DISTANCE,
        chunk_padding=chunk_padding,
        chunk_step_distance=chunk_step_distance,
        rotate_tool_with_path=rotate_tool_with_path,
        should_cancel=should_cancel,
        progress_callback=report_prepare_progress,
    )
    if not prepared_chunks:
        raise RuntimeError("Simulation produced no chunks.")

    final_mesh_bytes = manifold_to_simplified_glb(
        final_stock_manifold,
        context="final machined stock",
        stock_like_original_ids=prepared_chunks[0].stock_like_original_ids,
    )

    chunks: list[SimulatedChunk] = []

    for chunk_list_index, prepared_chunk in enumerate(prepared_chunks):
        if should_cancel and should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        if progress_callback:
            progress_callback(
                85 + round((chunk_list_index / max(len(prepared_chunks), 1)) * 14),
                f"Preparing cached chunk mesh {chunk_list_index + 1} of {len(prepared_chunks)}.",
            )
        cached_mesh_bytes = manifold_to_simplified_glb(
            prepared_chunk.rest_mesh,
            context=f"extracting cached mesh for chunk {prepared_chunk.chunk_index}",
            stock_like_original_ids=prepared_chunk.stock_like_original_ids,
        )
        chunks.append(
            SimulatedChunk(
                cached_mesh_bytes=cached_mesh_bytes,
                frame_start_index=0,
                frame_end_index=0,
            )
        )
        if progress_callback:
            progress_callback(
                85 + round(((chunk_list_index + 1) / max(len(prepared_chunks), 1)) * 14),
                f"Cached chunk mesh {chunk_list_index + 1} of {len(prepared_chunks)}.",
            )

    return BufferedSimulationResult(
        tool_mesh_bytes=maybe_compress_glb(
            build_tool_mesh_glb_from_tool(operation.tool),
            context="tool mesh",
        ),
        chunks=chunks,
        prepared_chunks=prepared_chunks,
        operation=operation,
        frames=_build_animation_frames(
            _build_contact_frames(prepared_chunks, frame_step_distance),
            operation,
            frame_step_distance,
            rapid_frame_step_scale=rapid_frame_step_scale,
        ),
        frame_step_distance=frame_step_distance,
        rapid_frame_step_scale=rapid_frame_step_scale,
        rotate_tool_with_path=rotate_tool_with_path,
        include_corner_rotation_sweeps=include_corner_rotation_sweeps,
        stock_mesh_bytes=mesh_bytes,
        final_mesh_bytes=final_mesh_bytes,
    )


def _active_mesh_bytes(
    simulation: BufferedSimulationResult,
    chunk_index: int,
    active_mesh_index: int,
) -> bytes:
    # Active (in-process focus) meshes are double-indexed by (chunk_index,
    # active_mesh_index). Cached globally in an LRU bounded by ACTIVE_MESH_CACHE_LIMIT.
    cache_key = (chunk_index, active_mesh_index)
    with simulation.active_mesh_cache_lock:
        cached = simulation.active_mesh_cache.get(cache_key)
        if cached is not None:
            simulation.active_mesh_cache.move_to_end(cache_key)
            return cached

    prepared_chunk = simulation.prepared_chunks[chunk_index]
    active_mesh = (
        prepared_chunk.focus_mesh
        if active_mesh_index < 0
        else simulate_chunk_focus_mesh(
            prepared_chunk.focus_mesh,
            prepared_chunk.cl_data,
            resample_chunk_cl_data(prepared_chunk.cl_data, simulation.frame_step_distance),
            active_mesh_index,
            context=f"chunk {chunk_index} frame {active_mesh_index}",
            rotate_tool_with_path=simulation.rotate_tool_with_path,
            include_corner_rotation_sweeps=simulation.include_corner_rotation_sweeps,
        )
    )
    mesh_bytes = manifold_to_simplified_glb(
        active_mesh,
        context=f"extracting active mesh for chunk {chunk_index} frame {active_mesh_index}",
        stock_like_original_ids=prepared_chunk.stock_like_original_ids,
    )
    with simulation.active_mesh_cache_lock:
        simulation.active_mesh_cache[cache_key] = mesh_bytes
        while len(simulation.active_mesh_cache) > ACTIVE_MESH_CACHE_LIMIT:
            simulation.active_mesh_cache.popitem(last=False)

    return mesh_bytes

def _get_simulation_task(task_id: str) -> SimulationTask:
    task = SIMULATION_TASKS.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Simulation task not found.")
    return task


def _build_status_response(task_id: str, task: SimulationTask) -> SweptSimulationStatusResponse:
    progress_total = max(task.progress_total, 1)
    progress_percent = min(100.0, max(0.0, (task.progress_current / progress_total) * 100.0))
    if task.status == "completed":
        progress_percent = 100.0

    return SweptSimulationStatusResponse(
        task_id=task_id,
        status=task.status,
        progress_percent=progress_percent,
        message=task.message,
        error_detail=task.error_detail,
        result=task.result,
    )


def _update_simulation_task(
    task_id: str,
    *,
    status: str | None = None,
    progress_current: int | None = None,
    progress_total: int | None = None,
    message: str | None = None,
    error_detail: str | None = None,
    result: SweptSimulationResponse | None = None,
) -> None:
    with SIMULATION_TASKS_LOCK:
        task = _get_simulation_task(task_id)
        if status is not None:
            task.status = status
        if progress_current is not None:
            task.progress_current = progress_current
        if progress_total is not None:
            task.progress_total = max(progress_total, 1)
        if message is not None:
            task.message = message
        if error_detail is not None:
            task.error_detail = error_detail
        if result is not None:
            task.result = result


def _run_swept_simulation_task(
    task_id: str,
    mesh_bytes: bytes,
    parsed_operation: OperationRecord3D,
    run_id: str,
    chunk_padding_x: float,
    chunk_padding_y: float,
    chunk_padding_z: float,
    chunk_step_distance: float,
    rotate_tool_with_path: bool,
    include_corner_rotation_sweeps: bool,
) -> None:
    def should_cancel() -> bool:
        with SIMULATION_TASKS_LOCK:
            task = _get_simulation_task(task_id)
            return task.cancel_event.is_set()

    def report_progress(progress_percent: int, message: str) -> None:
        _update_simulation_task(
            task_id,
            status="running",
            progress_current=max(0, min(progress_percent, 99)),
            progress_total=100,
            message=message,
        )

    try:
        _update_simulation_task(
            task_id,
            status="running",
            progress_current=0,
            progress_total=100,
            message="Preparing simulation chunks...",
        )
        simulation = _build_buffered_simulation(
            mesh_bytes,
            parsed_operation,
            chunk_padding=(chunk_padding_x, chunk_padding_y, chunk_padding_z),
            chunk_step_distance=chunk_step_distance,
            rotate_tool_with_path=rotate_tool_with_path,
            include_corner_rotation_sweeps=include_corner_rotation_sweeps,
            should_cancel=should_cancel,
            progress_callback=report_progress,
        )
        if should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        simulation_id = str(uuid4())
        log_simulation_frames(
            run_id,
            simulation_id,
            [frame.cl_record_index for frame in simulation.frames],
        )
        with SIMULATION_FRAME_BUFFER_LOCK:
            SIMULATION_FRAME_BUFFER[simulation_id] = simulation
        Thread(target=_run_comparison_mesh_build, args=(simulation,), daemon=True).start()

        final_frame_index = len(simulation.frames) - 1
        final_frame = simulation.frames[final_frame_index]
        final_chunk = simulation.prepared_chunks[final_frame.chunk_index]
        result = _simulation_response(simulation_id, simulation)
        _update_simulation_task(
            task_id,
            status="completed",
            progress_current=1,
            progress_total=1,
            message="Simulation chunks ready.",
            result=result,
        )
    except SimulationCancelledError:
        _update_simulation_task(
            task_id,
            status="cancelled",
            message="Simulation cancelled.",
            error_detail=None,
        )
    except ValueError as exc:
        _update_simulation_task(task_id, status="error", message="Simulation failed.", error_detail=str(exc))
    except RuntimeError as exc:
        _update_simulation_task(task_id, status="error", message="Simulation failed.", error_detail=str(exc))
    except Exception as exc:  # pragma: no cover
        _update_simulation_task(task_id, status="error", message="Simulation failed.", error_detail=str(exc))


@router.post("/simulate", response_model=SweptSimulationStartResponse)
async def simulate_swept(
    mesh: UploadFile | None = File(None),
    operation: str = Form(...),
    run_id: str | None = Form(None),
    chunk_padding_x: float = Form(5.0),
    chunk_padding_y: float = Form(5.0),
    chunk_padding_z: float = Form(1.0),
    chunk_step_distance: float = Form(DEFAULT_CHUNK_STEP_DISTANCE),
    rotate_tool_with_path: bool = Form(DEFAULT_ROTATE_TOOL_WITH_PATH),
    include_corner_rotation_sweeps: bool = Form(DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS),
):
    try:
        parsed_operation = OperationRecord3D.model_validate_json(operation)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    try:
        run_id = ensure_logged_cl(parsed_operation, run_id)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mesh_bytes = await mesh.read() if mesh is not None else None
    if mesh is not None and not mesh_bytes:
        raise HTTPException(status_code=400, detail="Mesh upload is empty.")
    if mesh_bytes is None:
        cached_mesh = get_mesh_cache().get_mesh()
        if cached_mesh is None:
            raise HTTPException(status_code=400, detail="Upload a STEP file before running simulation.")
        mesh_bytes = cached_mesh.mesh_bytes

    if any(not np.isfinite(padding) or padding < 0 for padding in (chunk_padding_x, chunk_padding_y, chunk_padding_z)):
        raise HTTPException(status_code=400, detail="Chunk padding values must be non-negative.")

    if not np.isfinite(chunk_step_distance) or chunk_step_distance <= 0:
        raise HTTPException(status_code=400, detail="chunk_step_distance must be positive.")

    task_id = str(uuid4())
    with SIMULATION_TASKS_LOCK:
        SIMULATION_TASKS[task_id] = SimulationTask(message="Queued simulation...")

    Thread(
        target=_run_swept_simulation_task,
        args=(
            task_id,
            mesh_bytes,
            parsed_operation,
            run_id,
            chunk_padding_x,
            chunk_padding_y,
            chunk_padding_z,
            chunk_step_distance,
            rotate_tool_with_path,
            include_corner_rotation_sweeps,
        ),
        daemon=True,
    ).start()

    return SweptSimulationStartResponse(task_id=task_id)


@router.get("/simulate/{task_id}/status", response_model=SweptSimulationStatusResponse)
def simulate_swept_status(task_id: str):
    with SIMULATION_TASKS_LOCK:
        task = _get_simulation_task(task_id)
        return _build_status_response(task_id, task)


@router.delete("/simulate/{task_id}", response_model=SweptSimulationStatusResponse)
def cancel_simulate_swept(task_id: str):
    with SIMULATION_TASKS_LOCK:
        task = _get_simulation_task(task_id)
        if task.status not in {"completed", "cancelled", "error"}:
            task.cancel_event.set()
            task.status = "cancelling"
            task.message = "Cancelling simulation..."
        return _build_status_response(task_id, task)


@router.get("/simulate/{simulation_id}/tool-mesh.glb")
def simulate_swept_tool_mesh(simulation_id: str):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)

    return Response(content=simulation.tool_mesh_bytes, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/tool-mesh.rhino.json")
def simulate_swept_tool_mesh_rhino_json(simulation_id: str):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)

    try:
        return _rhino_mesh_response(simulation.tool_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/simulate/{simulation_id}/final-mesh.glb")
def simulate_swept_final_mesh(simulation_id: str):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        mesh_bytes = simulation.final_mesh_bytes

    return Response(content=mesh_bytes, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/comparison", response_model=SweptSimulationComparisonResponse)
def simulate_swept_comparison(simulation_id: str):
    started_at = time.perf_counter()
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        if not simulation.frames:
            raise HTTPException(status_code=404, detail="Simulation has no frames.")
        _comparison_meshes(simulation)
        comparison_version = simulation.comparison_mesh_generation

    _comparison_debug("prepare-endpoint", started_at, simulation_id=simulation_id)
    return SweptSimulationComparisonResponse(
        cached_mesh_url=_comparison_cached_mesh_url(simulation_id, comparison_version),
        active_mesh_url=_comparison_active_mesh_url(simulation_id, comparison_version),
    )


@router.get("/simulate/{simulation_id}/comparison/cached-mesh.glb")
def simulate_swept_comparison_cached_mesh(simulation_id: str):
    started_at = time.perf_counter()
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        cached_mesh, _active_mesh = _comparison_meshes(simulation)

    _comparison_debug("cached-mesh-endpoint", started_at, simulation_id=simulation_id, bytes=len(cached_mesh))
    return Response(content=cached_mesh, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/comparison/active-mesh.glb")
def simulate_swept_comparison_active_mesh(simulation_id: str):
    started_at = time.perf_counter()
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        _cached_mesh, active_mesh = _comparison_meshes(simulation)

    _comparison_debug("active-mesh-endpoint", started_at, simulation_id=simulation_id, bytes=len(active_mesh))
    return Response(content=active_mesh, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/chunks/{chunk_index}/active-meshes/{active_mesh_index}.glb")
def simulate_swept_chunk_active_mesh(
    simulation_id: str,
    chunk_index: int,
    active_mesh_index: int,
):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        _get_buffered_chunk(simulation, chunk_index)

    return Response(
        content=_active_mesh_bytes(simulation, chunk_index, active_mesh_index),
        media_type="model/gltf-binary",
    )


@router.get("/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb")
def simulate_swept_chunk_cached_mesh(
    simulation_id: str,
    chunk_index: int,
):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    return Response(content=chunk.cached_mesh_bytes, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.rhino.json")
def simulate_swept_chunk_cached_mesh_rhino_json(
    simulation_id: str,
    chunk_index: int,
):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    try:
        return _rhino_mesh_response(chunk.cached_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
