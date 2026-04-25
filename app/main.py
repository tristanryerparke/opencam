import json
from datetime import datetime
from pathlib import Path as FilePath
from threading import Lock

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from models import SweptSimulationRequest, SweptSimulationResponse, ToolpathOperation
from pocketing import ClosedPocketingEngine
from profiling import ClosedProfilingEngine
from swept_volume_simulation import simulate_swept_milling

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
        # Dev-only logging should never block a successful toolpath response.
        pass


def _build_toolpath_operation(engine, endpoint: str) -> ToolpathOperation:
    operation = ToolpathOperation(tool=engine.tool, paths=engine.process())
    _log_frontend_paths(endpoint, operation)
    return operation


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
def simulate_swept(request: SweptSimulationRequest):
    try:
        return SweptSimulationResponse(
            mesh_data_url=simulate_swept_milling(
                request.mesh_data_url,
                request.operation,
            )
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
