import io
import json
from collections.abc import Callable
from dataclasses import dataclass, field
from threading import Event, Lock, Thread
from uuid import uuid4

from fastapi import APIRouter, File, Form, HTTPException, Response, UploadFile
from pydantic import ValidationError
import numpy as np
import rhino3dm
import trimesh

from opencam.schemas.cl_data import OperationRecord3D, PositionRecord3D
from opencam.schemas.tools import CylindricalTool
from opencam.services.mesh_cache import get_mesh_cache
from opencam.simulation.models import (
    SweptSimulationFrameResponse,
    SweptSimulationFramesResponse,
    SweptSimulationResampleRequest,
    SweptSimulationResponse,
    SweptSimulationStartResponse,
    SweptSimulationStatusResponse,
)
from opencam.simulation.swept_volume import (
    DEFAULT_CHUNK_STEP_DISTANCE,
    DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS,
    DEFAULT_MAX_SIM_DISTANCE,
    DEFAULT_ROTATE_TOOL_WITH_PATH,
    SIM_STEPDISTANCE,
    TOOL_SEGMENTS,
    PreparedSimulationChunk,
    SimulatedChunk,
    SimulationCancelledError,
    build_cylinder_mesh,
    manifold_to_simplified_glb,
    map_positions_to_operation_progress,
    positions_match,
    prepare_simulation_chunks,
    sample_operation_points_with_progress,
    resample_chunk_cl_data,
    simulate_chunk_focus_mesh,
    write_glb,
)

router = APIRouter()


@dataclass(frozen=True)
class PreparedSimulationFrame:
    chunk_index: int
    point_index: int
    tool_position: PositionRecord3D
    chunk_step_count: int = 0


@dataclass
class BufferedSimulationResult:
    tool_mesh_bytes: bytes
    chunks: list[SimulatedChunk]
    prepared_chunks: list[PreparedSimulationChunk]
    operation: OperationRecord3D
    frames: list[PreparedSimulationFrame]
    frame_step_distance: float
    rotate_tool_with_path: bool = DEFAULT_ROTATE_TOOL_WITH_PATH
    include_corner_rotation_sweeps: bool = DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS
    # ponytail: cache grows with viewed frames; add LRU eviction if live simulation memory proves material.
    active_mesh_cache: dict[int, bytes] = field(default_factory=dict)
    active_mesh_cache_lock: Lock = field(default_factory=Lock)


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


def _frame_active_mesh_url(simulation_id: str, frame_index: int) -> str:
    return f"/simulate/{simulation_id}/frames/{frame_index}/active-mesh.glb"


def _chunk_cached_mesh_url(simulation_id: str, chunk_index: int) -> str:
    return f"/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb"


def _load_trimesh_from_bytes(mesh_bytes: bytes, file_type: str) -> trimesh.Trimesh:
    loaded = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    if loaded is None or getattr(loaded, "is_empty", False):
        raise ValueError("Mesh asset is empty or unreadable.")
    if not isinstance(loaded, trimesh.Trimesh):
        loaded = trimesh.util.concatenate(tuple(loaded.dump()))
    if len(loaded.vertices) == 0 or len(loaded.faces) == 0:
        raise ValueError("Mesh asset contains no faces.")
    return loaded


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


def _frame_response(
    simulation_id: str,
    simulation: BufferedSimulationResult,
    frame_index: int,
    frame: PreparedSimulationFrame,
) -> SweptSimulationFrameResponse:
    chunk = simulation.prepared_chunks[frame.chunk_index]
    return SweptSimulationFrameResponse(
        active_mesh_url=_frame_active_mesh_url(simulation_id, frame_index),
        cached_mesh_url=_chunk_cached_mesh_url(simulation_id, frame.chunk_index),
        chunk_index=frame.chunk_index,
        chunk_step_index=frame.point_index if frame.point_index >= 0 else None,
        chunk_step_count=frame.chunk_step_count,
        chunk_toolpath_points=chunk.cl_data.points,
        tool_position=frame.tool_position,
        rotate_tool_with_path=simulation.rotate_tool_with_path,
    )


def _get_buffered_simulation(simulation_id: str) -> BufferedSimulationResult:
    simulation = SIMULATION_FRAME_BUFFER.get(simulation_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation result not found.")
    return simulation


def _get_buffered_frame(
    simulation: BufferedSimulationResult,
    frame_index: int,
) -> PreparedSimulationFrame:
    if frame_index < 0 or frame_index >= len(simulation.frames):
        raise HTTPException(status_code=404, detail="Simulation frame not found.")
    return simulation.frames[frame_index]


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
            frames.extend(
                PreparedSimulationFrame(
                    chunk_index=prepared_chunk.chunk_index,
                    point_index=point_index,
                    tool_position=point,
                    chunk_step_count=chunk_step_count,
                )
                for point_index, point in enumerate(sampled_points)
            )
            continue

        fallback_position = prepared_chunk.cl_data.points[0] if prepared_chunk.cl_data.points else PositionRecord3D(x=0.0, y=0.0, z=0.0)
        frames.append(
            PreparedSimulationFrame(
                chunk_index=prepared_chunk.chunk_index,
                point_index=-1,
                tool_position=fallback_position,
                chunk_step_count=0,
            )
        )

    return frames


def _build_animation_frames(
    mesh_frames: list[PreparedSimulationFrame],
    operation: OperationRecord3D,
    frame_step_distance: float,
) -> list[PreparedSimulationFrame]:
    sampled_points = sample_operation_points_with_progress(operation, frame_step_distance)
    if not mesh_frames or not sampled_points:
        return mesh_frames

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
    )
    mesh_frame_index = 0
    animation_frames: list[PreparedSimulationFrame] = []

    for progress, position in sampled_points:
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
    frame_step_distance: float,
    rotate_tool_with_path: bool,
    include_corner_rotation_sweeps: bool,
    should_cancel: Callable[[], bool] | None,
    progress_callback: Callable[[int, str], None] | None = None,
) -> BufferedSimulationResult:
    def report_prepare_progress(current: int, total: int, message: str) -> None:
        if progress_callback:
            progress_callback(round((current / max(total, 1)) * 85), message)

    prepared_chunks = prepare_simulation_chunks(
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

    tool_vertices, tool_faces = build_cylinder_mesh(
        operation.tool.diameter,
        operation.tool.cutting_height,
        TOOL_SEGMENTS,
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
        tool_mesh_bytes=write_glb(tool_vertices, tool_faces),
        chunks=chunks,
        prepared_chunks=prepared_chunks,
        operation=operation,
        frames=_build_animation_frames(_build_contact_frames(prepared_chunks, frame_step_distance), operation, frame_step_distance),
        frame_step_distance=frame_step_distance,
        rotate_tool_with_path=rotate_tool_with_path,
        include_corner_rotation_sweeps=include_corner_rotation_sweeps,
    )


def _resample_buffered_simulation(
    simulation: BufferedSimulationResult,
    frame_step_distance: float,
) -> None:
    with simulation.active_mesh_cache_lock:
        simulation.active_mesh_cache.clear()

    simulation.frames = _build_animation_frames(
        _build_contact_frames(simulation.prepared_chunks, frame_step_distance),
        simulation.operation,
        frame_step_distance,
    )
    simulation.frame_step_distance = frame_step_distance


def _active_mesh_bytes(simulation: BufferedSimulationResult, frame_index: int) -> bytes:
    with simulation.active_mesh_cache_lock:
        cached_mesh_bytes = simulation.active_mesh_cache.get(frame_index)
        if cached_mesh_bytes is not None:
            return cached_mesh_bytes

        frame = _get_buffered_frame(simulation, frame_index)
        prepared_chunk = simulation.prepared_chunks[frame.chunk_index]
        active_mesh = (
            prepared_chunk.focus_mesh
            if frame.point_index < 0
            else simulate_chunk_focus_mesh(
                prepared_chunk.focus_mesh,
                prepared_chunk.cl_data,
                resample_chunk_cl_data(prepared_chunk.cl_data, simulation.frame_step_distance),
                frame.point_index,
                context=f"chunk {frame.chunk_index} frame {frame.point_index}",
                rotate_tool_with_path=simulation.rotate_tool_with_path,
                include_corner_rotation_sweeps=simulation.include_corner_rotation_sweeps,
            )
        )
        mesh_bytes = manifold_to_simplified_glb(
            active_mesh,
            context=f"extracting active mesh for chunk {frame.chunk_index} frame {frame.point_index}",
            stock_like_original_ids=prepared_chunk.stock_like_original_ids,
        )
        simulation.active_mesh_cache[frame_index] = mesh_bytes
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
    chunk_padding_x: float,
    chunk_padding_y: float,
    chunk_padding_z: float,
    chunk_step_distance: float,
    frame_step_distance: float,
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
            frame_step_distance=frame_step_distance,
            rotate_tool_with_path=rotate_tool_with_path,
            include_corner_rotation_sweeps=include_corner_rotation_sweeps,
            should_cancel=should_cancel,
            progress_callback=report_progress,
        )
        if should_cancel():
            raise SimulationCancelledError("Simulation generation cancelled.")

        simulation_id = str(uuid4())
        with SIMULATION_FRAME_BUFFER_LOCK:
            SIMULATION_FRAME_BUFFER[simulation_id] = simulation

        final_frame_index = len(simulation.frames) - 1
        final_frame = simulation.frames[final_frame_index]
        final_chunk = simulation.prepared_chunks[final_frame.chunk_index]
        result = SweptSimulationResponse(
            active_mesh_url=_frame_active_mesh_url(simulation_id, final_frame_index),
            cached_mesh_url=_chunk_cached_mesh_url(simulation_id, final_frame.chunk_index),
            simulation_id=simulation_id,
            frame_count=len(simulation.frames),
            chunk_count=len(simulation.chunks),
            chunk_index=final_frame.chunk_index,
            chunk_step_index=final_frame.point_index if final_frame.point_index >= 0 else None,
            chunk_step_count=final_frame.chunk_step_count,
            chunk_toolpath_points=final_chunk.cl_data.points,
            tool_mesh_url=_tool_mesh_url(simulation_id),
            tool_position=final_frame.tool_position,
            rotate_tool_with_path=simulation.rotate_tool_with_path,
        )
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
    chunk_padding_x: float = Form(5.0),
    chunk_padding_y: float = Form(5.0),
    chunk_padding_z: float = Form(1.0),
    chunk_step_distance: float = Form(DEFAULT_CHUNK_STEP_DISTANCE),
    frame_step_distance: float = Form(SIM_STEPDISTANCE),
    rotate_tool_with_path: bool = Form(DEFAULT_ROTATE_TOOL_WITH_PATH),
    include_corner_rotation_sweeps: bool = Form(DEFAULT_INCLUDE_CORNER_ROTATION_SWEEPS),
):
    try:
        parsed_operation = OperationRecord3D.model_validate_json(operation)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    if not isinstance(parsed_operation.tool, CylindricalTool):
        raise HTTPException(
            status_code=501,
            detail=f"Tool type {parsed_operation.tool.type!r} is not supported for swept simulation.",
        )

    mesh_bytes = await mesh.read() if mesh is not None else None
    if mesh is not None and not mesh_bytes:
        raise HTTPException(status_code=400, detail="Mesh upload is empty.")
    if mesh_bytes is None:
        cached_mesh = get_mesh_cache().get_mesh()
        if cached_mesh is None:
            raise HTTPException(status_code=400, detail="Upload an STL before running simulation.")
        mesh_bytes = cached_mesh.mesh_bytes

    if any(not np.isfinite(padding) or padding < 0 for padding in (chunk_padding_x, chunk_padding_y, chunk_padding_z)):
        raise HTTPException(status_code=400, detail="Chunk padding values must be non-negative.")

    if not np.isfinite(chunk_step_distance) or chunk_step_distance <= 0:
        raise HTTPException(status_code=400, detail="chunk_step_distance must be positive.")

    if not np.isfinite(frame_step_distance) or frame_step_distance <= 0:
        raise HTTPException(status_code=400, detail="frame_step_distance must be positive.")

    task_id = str(uuid4())
    with SIMULATION_TASKS_LOCK:
        SIMULATION_TASKS[task_id] = SimulationTask(message="Queued simulation...")

    Thread(
        target=_run_swept_simulation_task,
        args=(
            task_id,
            mesh_bytes,
            parsed_operation,
            chunk_padding_x,
            chunk_padding_y,
            chunk_padding_z,
            chunk_step_distance,
            frame_step_distance,
            rotate_tool_with_path,
            include_corner_rotation_sweeps,
        ),
        daemon=True,
    ).start()

    return SweptSimulationStartResponse(task_id=task_id)


@router.post("/simulate/{simulation_id}/resample", response_model=SweptSimulationResponse)
def resample_simulation(simulation_id: str, request: SweptSimulationResampleRequest):
    if not np.isfinite(request.frame_step_distance) or request.frame_step_distance <= 0:
        raise HTTPException(status_code=400, detail="frame_step_distance must be positive.")

    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        _resample_buffered_simulation(simulation, request.frame_step_distance)
        final_frame_index = len(simulation.frames) - 1
        final_frame = simulation.frames[final_frame_index]
        final_chunk = simulation.prepared_chunks[final_frame.chunk_index]

    return SweptSimulationResponse(
        active_mesh_url=_frame_active_mesh_url(simulation_id, final_frame_index),
        cached_mesh_url=_chunk_cached_mesh_url(simulation_id, final_frame.chunk_index),
        simulation_id=simulation_id,
        frame_count=len(simulation.frames),
        chunk_count=len(simulation.chunks),
        chunk_index=final_frame.chunk_index,
        chunk_step_index=final_frame.point_index if final_frame.point_index >= 0 else None,
        chunk_step_count=final_frame.chunk_step_count,
        chunk_toolpath_points=final_chunk.cl_data.points,
        tool_mesh_url=_tool_mesh_url(simulation_id),
        tool_position=final_frame.tool_position,
        rotate_tool_with_path=simulation.rotate_tool_with_path,
    )


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


@router.get(
    "/simulate/{simulation_id}/frames",
    response_model=SweptSimulationFramesResponse,
)
def simulate_swept_frames(simulation_id: str, start_index: int, count: int):
    if start_index < 0:
        raise HTTPException(status_code=400, detail="start_index must be non-negative.")

    if count <= 0:
        raise HTTPException(status_code=400, detail="count must be positive.")

    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        if start_index >= len(simulation.frames):
            raise HTTPException(status_code=404, detail="Simulation frame not found.")

        end_index = min(start_index + count, len(simulation.frames))
        frames = [
            _frame_response(simulation_id, simulation, frame_index, simulation.frames[frame_index])
            for frame_index in range(start_index, end_index)
        ]

    return SweptSimulationFramesResponse(start_index=start_index, frames=frames)


@router.get(
    "/simulate/{simulation_id}/frames/{frame_index}",
    response_model=SweptSimulationFrameResponse,
)
def simulate_swept_frame(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        frame = _get_buffered_frame(simulation, frame_index)

    return _frame_response(simulation_id, simulation, frame_index, frame)


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


@router.get("/simulate/{simulation_id}/frames/{frame_index}/active-mesh.glb")
def simulate_swept_frame_active_mesh(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        _get_buffered_frame(simulation, frame_index)

    return Response(content=_active_mesh_bytes(simulation, frame_index), media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/frames/{frame_index}/active-mesh.rhino.json")
def simulate_swept_frame_active_mesh_rhino_json(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        _get_buffered_frame(simulation, frame_index)

    try:
        return _rhino_mesh_response(_active_mesh_bytes(simulation, frame_index))
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb")
def simulate_swept_chunk_cached_mesh(simulation_id: str, chunk_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    return Response(content=chunk.cached_mesh_bytes, media_type="model/gltf-binary")


@router.get("/simulate/{simulation_id}/chunks/{chunk_index}/cached-mesh.rhino.json")
def simulate_swept_chunk_cached_mesh_rhino_json(simulation_id: str, chunk_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    try:
        return _rhino_mesh_response(chunk.cached_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
