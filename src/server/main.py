import io
import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path as FilePath
from threading import Event, Lock, Thread
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError
import numpy as np
import rhino3dm
import trimesh

from opencam.schemas.models import (
    SweptSimulationFrameResponse,
    SweptSimulationFramesResponse,
    SweptSimulationResponse,
    SweptSimulationStartResponse,
    SweptSimulationStatusResponse,
    ToolpathOperation,
)
from opencam.services.toolpath.pocketing import ClosedPocketingEngine
from opencam.services.toolpath.profiling import ClosedProfilingEngine
from opencam.services.simulation.swept_volume import (
    SimulatedChunk,
    SimulatedMeshFrame,
    SimulationCancelledError,
    simulate_swept_milling_frames,
)

app = FastAPI(title="OpenCAM API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_PATH_LOG_FILE = FilePath(__file__).resolve().parents[2] / "frontend-paths.json"
FRONTEND_PATH_LOG_LOCK = Lock()


@dataclass
class BufferedSimulationResult:
    tool_mesh_bytes: bytes
    chunks: list[SimulatedChunk]
    frames: list[SimulatedMeshFrame]


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


def _log_frontend_paths(endpoint: str, operation: ToolpathOperation) -> None:
    try:
        entry = {
            "timestamp": datetime.now().isoformat(),
            "endpoint": endpoint,
            "paths": operation.model_dump(mode="json", by_alias=True)["paths"],
        }

        with FRONTEND_PATH_LOG_LOCK:
            FRONTEND_PATH_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)

            entries: list[dict[str, object]] = []
            if FRONTEND_PATH_LOG_FILE.exists():
                try:
                    loaded_entries = json.loads(FRONTEND_PATH_LOG_FILE.read_text())
                except json.JSONDecodeError:
                    loaded_entries = []

                if isinstance(loaded_entries, list):
                    entries = loaded_entries

            entries.append(entry)
            FRONTEND_PATH_LOG_FILE.write_text(json.dumps(entries, indent=2))
    except OSError:
        pass


def _build_toolpath_operation(engine, endpoint: str) -> ToolpathOperation:
    operation = ToolpathOperation(tool=engine.tool, paths=engine.process())
    _log_frontend_paths(endpoint, operation)
    return operation


def _tool_mesh_url(simulation_id: str) -> str:
    return f"/simulate/swept/{simulation_id}/tool-mesh.glb"


def _frame_active_mesh_url(simulation_id: str, frame_index: int) -> str:
    return f"/simulate/swept/{simulation_id}/frames/{frame_index}/active-mesh.glb"


def _chunk_cached_mesh_url(simulation_id: str, chunk_index: int) -> str:
    return f"/simulate/swept/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb"


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


def _frame_response(simulation_id: str, frame_index: int, frame: SimulatedMeshFrame) -> SweptSimulationFrameResponse:
    return SweptSimulationFrameResponse(
        active_mesh_url=_frame_active_mesh_url(simulation_id, frame_index),
        cached_mesh_url=_chunk_cached_mesh_url(simulation_id, frame.chunk_index),
        chunk_index=frame.chunk_index,
        tool_position=frame.tool_position,
    )


def _get_buffered_simulation(simulation_id: str) -> BufferedSimulationResult:
    simulation = SIMULATION_FRAME_BUFFER.get(simulation_id)
    if simulation is None:
        raise HTTPException(status_code=404, detail="Simulation result not found.")
    return simulation


def _get_buffered_frame(simulation: BufferedSimulationResult, frame_index: int) -> SimulatedMeshFrame:
    if frame_index < 0 or frame_index >= len(simulation.frames):
        raise HTTPException(status_code=404, detail="Simulation frame not found.")
    return simulation.frames[frame_index]


def _get_buffered_chunk(simulation: BufferedSimulationResult, chunk_index: int) -> SimulatedChunk:
    if chunk_index < 0 or chunk_index >= len(simulation.chunks):
        raise HTTPException(status_code=404, detail="Simulation chunk not found.")
    return simulation.chunks[chunk_index]


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
    parsed_operation: ToolpathOperation,
    max_sim_distance: float,
    chunk_padding_x: float,
    chunk_padding_y: float,
    chunk_padding_z: float,
) -> None:
    def should_cancel() -> bool:
        with SIMULATION_TASKS_LOCK:
            task = _get_simulation_task(task_id)
            return task.cancel_event.is_set()

    def progress_callback(current: int, total: int, message: str) -> None:
        with SIMULATION_TASKS_LOCK:
            task = _get_simulation_task(task_id)
            if task.cancel_event.is_set():
                task.status = "cancelling"
                task.message = "Cancelling simulation..."
                return

            task.status = "running"
            task.progress_current = current
            task.progress_total = max(total, 1)
            task.message = message

    try:
        _update_simulation_task(task_id, status="running", message="Preparing simulation...")
        tool_mesh_bytes, simulation_chunks, frame_meshes = simulate_swept_milling_frames(
            mesh_bytes,
            parsed_operation,
            max_sim_distance=max_sim_distance,
            chunk_padding=(chunk_padding_x, chunk_padding_y, chunk_padding_z),
            progress_callback=progress_callback,
            should_cancel=should_cancel,
        )
        simulation_id = str(uuid4())

        with SIMULATION_FRAME_BUFFER_LOCK:
            SIMULATION_FRAME_BUFFER[simulation_id] = BufferedSimulationResult(
                tool_mesh_bytes=tool_mesh_bytes,
                chunks=simulation_chunks,
                frames=frame_meshes,
            )

        final_frame_index = len(frame_meshes) - 1
        final_frame = frame_meshes[final_frame_index]
        result = SweptSimulationResponse(
            active_mesh_url=_frame_active_mesh_url(simulation_id, final_frame_index),
            cached_mesh_url=_chunk_cached_mesh_url(simulation_id, final_frame.chunk_index),
            simulation_id=simulation_id,
            frame_count=len(frame_meshes),
            chunk_count=len(simulation_chunks),
            chunk_index=final_frame.chunk_index,
            tool_mesh_url=_tool_mesh_url(simulation_id),
            tool_position=final_frame.tool_position,
        )
        _update_simulation_task(
            task_id,
            status="completed",
            progress_current=1,
            progress_total=1,
            message="Simulation completed.",
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


@app.get("/test")
async def root():
    return {"message": "hello from opencam"}


@app.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.post("/profile/closed", response_model=ToolpathOperation)
async def profile_closed(engine: ClosedProfilingEngine):
    try:
        return _build_toolpath_operation(engine, "/profile/closed")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/pocket/closed", response_model=ToolpathOperation)
async def pocket_closed(engine: ClosedPocketingEngine):
    try:
        return _build_toolpath_operation(engine, "/pocket/closed")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.post("/simulate/swept", response_model=SweptSimulationStartResponse)
async def simulate_swept(
    mesh: UploadFile = File(...),
    operation: str = Form(...),
    max_sim_distance: float = Form(30.0),
    chunk_padding_x: float = Form(5.0),
    chunk_padding_y: float = Form(5.0),
    chunk_padding_z: float = Form(1.0),
):
    try:
        parsed_operation = ToolpathOperation.model_validate_json(operation)
    except ValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    mesh_bytes = await mesh.read()
    if not mesh_bytes:
        raise HTTPException(status_code=400, detail="Mesh upload is empty.")

    if max_sim_distance <= 0:
        raise HTTPException(status_code=400, detail="max_sim_distance must be positive.")

    if chunk_padding_x < 0 or chunk_padding_y < 0 or chunk_padding_z < 0:
        raise HTTPException(status_code=400, detail="Chunk padding values must be non-negative.")

    task_id = str(uuid4())
    with SIMULATION_TASKS_LOCK:
        SIMULATION_TASKS[task_id] = SimulationTask(message="Queued simulation...")

    Thread(
        target=_run_swept_simulation_task,
        args=(
            task_id,
            mesh_bytes,
            parsed_operation,
            max_sim_distance,
            chunk_padding_x,
            chunk_padding_y,
            chunk_padding_z,
        ),
        daemon=True,
    ).start()

    return SweptSimulationStartResponse(task_id=task_id)


@app.get("/simulate/swept/{task_id}/status", response_model=SweptSimulationStatusResponse)
def simulate_swept_status(task_id: str):
    with SIMULATION_TASKS_LOCK:
        task = _get_simulation_task(task_id)
        return _build_status_response(task_id, task)


@app.delete("/simulate/swept/{task_id}", response_model=SweptSimulationStatusResponse)
def cancel_simulate_swept(task_id: str):
    with SIMULATION_TASKS_LOCK:
        task = _get_simulation_task(task_id)
        if task.status not in {"completed", "cancelled", "error"}:
            task.cancel_event.set()
            task.status = "cancelling"
            task.message = "Cancelling simulation..."
        return _build_status_response(task_id, task)


@app.get(
    "/simulate/swept/{simulation_id}/frames",
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
            _frame_response(simulation_id, frame_index, simulation.frames[frame_index])
            for frame_index in range(start_index, end_index)
        ]

    return SweptSimulationFramesResponse(start_index=start_index, frames=frames)


@app.get(
    "/simulate/swept/{simulation_id}/frames/{frame_index}",
    response_model=SweptSimulationFrameResponse,
)
def simulate_swept_frame(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        frame = _get_buffered_frame(simulation, frame_index)

    return _frame_response(simulation_id, frame_index, frame)


@app.get("/simulate/swept/{simulation_id}/tool-mesh.glb")
def simulate_swept_tool_mesh(simulation_id: str):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)

    return Response(content=simulation.tool_mesh_bytes, media_type="model/gltf-binary")


@app.get("/simulate/swept/{simulation_id}/tool-mesh.rhino.json")
def simulate_swept_tool_mesh_rhino_json(simulation_id: str):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)

    try:
        return _rhino_mesh_response(simulation.tool_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/simulate/swept/{simulation_id}/frames/{frame_index}/active-mesh.glb")
def simulate_swept_frame_active_mesh(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        frame = _get_buffered_frame(simulation, frame_index)

    return Response(content=frame.active_mesh_bytes, media_type="model/gltf-binary")


@app.get("/simulate/swept/{simulation_id}/frames/{frame_index}/active-mesh.rhino.json")
def simulate_swept_frame_active_mesh_rhino_json(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        frame = _get_buffered_frame(simulation, frame_index)

    try:
        return _rhino_mesh_response(frame.active_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@app.get("/simulate/swept/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb")
def simulate_swept_chunk_cached_mesh(simulation_id: str, chunk_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    return Response(content=chunk.cached_mesh_bytes, media_type="model/gltf-binary")


@app.get("/simulate/swept/{simulation_id}/chunks/{chunk_index}/cached-mesh.rhino.json")
def simulate_swept_chunk_cached_mesh_rhino_json(simulation_id: str, chunk_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    try:
        return _rhino_mesh_response(chunk.cached_mesh_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
