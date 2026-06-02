import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path as FilePath
from threading import Lock
from uuid import uuid4

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from models import SweptSimulationFrameResponse, SweptSimulationFramesResponse, SweptSimulationResponse, ToolpathOperation
from pocketing import ClosedPocketingEngine
from profiling import ClosedProfilingEngine
from swept_volume_simulation import SimulatedChunk, SimulatedMeshFrame, simulate_swept_milling_frames

app = FastAPI(title="Time Tracker API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

FRONTEND_PATH_LOG_FILE = FilePath(__file__).resolve().parents[1] / "frontend-paths.json"
FRONTEND_PATH_LOG_LOCK = Lock()


@dataclass
class BufferedSimulationResult:
    tool_mesh_bytes: bytes
    chunks: list[SimulatedChunk]
    frames: list[SimulatedMeshFrame]


SIMULATION_FRAME_BUFFER: dict[str, BufferedSimulationResult] = {}
SIMULATION_FRAME_BUFFER_LOCK = Lock()


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


@app.get("/test")
async def root():
    return {"message": "hello from web-app-template"}


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


@app.post("/simulate/swept", response_model=SweptSimulationResponse)
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

    try:
        tool_mesh_bytes, simulation_chunks, frame_meshes = simulate_swept_milling_frames(
            mesh_bytes,
            parsed_operation,
            max_sim_distance=max_sim_distance,
            chunk_padding=(chunk_padding_x, chunk_padding_y, chunk_padding_z),
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
        return SweptSimulationResponse(
            active_mesh_url=_frame_active_mesh_url(simulation_id, final_frame_index),
            cached_mesh_url=_chunk_cached_mesh_url(simulation_id, final_frame.chunk_index),
            simulation_id=simulation_id,
            frame_count=len(frame_meshes),
            chunk_count=len(simulation_chunks),
            chunk_index=final_frame.chunk_index,
            tool_mesh_url=_tool_mesh_url(simulation_id),
            tool_position=final_frame.tool_position,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


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


@app.get("/simulate/swept/{simulation_id}/frames/{frame_index}/active-mesh.glb")
def simulate_swept_frame_active_mesh(simulation_id: str, frame_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        frame = _get_buffered_frame(simulation, frame_index)

    return Response(content=frame.active_mesh_bytes, media_type="model/gltf-binary")


@app.get("/simulate/swept/{simulation_id}/chunks/{chunk_index}/cached-mesh.glb")
def simulate_swept_chunk_cached_mesh(simulation_id: str, chunk_index: int):
    with SIMULATION_FRAME_BUFFER_LOCK:
        simulation = _get_buffered_simulation(simulation_id)
        chunk = _get_buffered_chunk(simulation, chunk_index)

    return Response(content=chunk.cached_mesh_bytes, media_type="model/gltf-binary")
