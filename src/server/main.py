import logging
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware

from opencam.post_processing.duet3d.router import (
    router as duet3d_post_processing_router,
)
from opencam_contracts.cam import GenerateToolpathRequest
from opencam_contracts.cl_data import OperationRecord3D
from opencam_contracts.mesh import Mesh
from opencam_contracts.tools import Tool
from opencam.services.cam_engine import cam_engine
from opencam.services.mesh_cache import CachedMeshMetadata, get_mesh_cache
from opencam.services.tool_library import ToolLibrary, get_tool_library
from opencam.services.tool_mesh import build_tool
from opencam.simulation.router import router as simulation_router
from opencam.utilities.loader import step_to_mesh

logger = logging.getLogger(__name__)
app = FastAPI(title="OpenCAM API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Toolpath-Run-Id"],
)
app.include_router(simulation_router)
app.include_router(duet3d_post_processing_router)


@app.get("/test")
async def root():
    return {"message": "hello from opencam"}


@app.get("/ping")
async def ping():
    return {"status": "ok", "timestamp": datetime.now().isoformat()}


@app.get("/cam/tools", response_model=list[Tool])
def list_tools(tool_library: ToolLibrary = Depends(get_tool_library)):
    return tool_library.list_tools()


@app.post("/cam/tools", response_model=Tool, status_code=status.HTTP_201_CREATED)
def add_tool(tool: Tool, tool_library: ToolLibrary = Depends(get_tool_library)):
    try:
        return tool_library.add_tool(build_tool(tool))
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc


@app.get("/cam/tools/{tool_id}", response_model=Tool)
def get_tool(tool_id: str, tool_library: ToolLibrary = Depends(get_tool_library)):
    tool = tool_library.get_tool(tool_id)
    if tool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    return tool


@app.put("/cam/tools/{tool_id}", response_model=Tool)
def update_tool(tool_id: str, tool: Tool, tool_library: ToolLibrary = Depends(get_tool_library)):
    if tool.id != tool_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tool ID cannot be changed.")

    try:
        updated_tool = tool_library.update_tool(tool_id, build_tool(tool, tool_id=tool_id))
    except NotImplementedError as exc:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(exc)) from exc
    if updated_tool is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    return updated_tool


@app.delete("/cam/tools/{tool_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tool(tool_id: str, tool_library: ToolLibrary = Depends(get_tool_library)):
    if not tool_library.delete_tool(tool_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool not found.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/cam/mesh", response_model=CachedMeshMetadata)
def get_cached_mesh_metadata():
    metadata = get_mesh_cache().get_metadata()
    if metadata is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mesh not found.")
    return metadata


@app.post("/cam/mesh", response_model=CachedMeshMetadata, status_code=status.HTTP_201_CREATED)
async def cache_mesh(step: UploadFile = File(...)):
    step_bytes = await step.read()
    suffix = Path(step.filename or "part.step").suffix.lower()
    if suffix not in {".step", ".stp"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A STEP file is required.")

    try:
        with TemporaryDirectory() as directory:
            step_path = Path(directory) / f"part{suffix}"
            step_path.write_bytes(step_bytes)
            mesh = step_to_mesh(step_path)
        return get_mesh_cache().set_step(step.filename or "mesh.step", step_bytes, mesh)
    except (OSError, RuntimeError, ValueError) as exc:
        logger.exception("STEP mesh conversion failed")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/cam/mesh/file")
def get_cached_mesh_file(v: str | None = None):
    cached_mesh = get_mesh_cache().get_mesh()
    if cached_mesh is None or (v is not None and v != cached_mesh.version):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mesh not found.")
    return Response(
        content=cached_mesh.mesh.model_dump_json(by_alias=True),
        media_type="application/json",
    )


@app.delete("/cam/mesh", status_code=status.HTTP_204_NO_CONTENT)
def clear_cached_mesh():
    get_mesh_cache().clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


def server_cached_mesh_loader(cache_id: str) -> Mesh | None:
    """Resolve a cached-mesh reference to inline mesh data from the mesh cache."""
    record = get_mesh_cache().get_mesh()
    if record is None or record.version != cache_id:
        return None
    return record.mesh


@app.post("/cam/toolpath", response_model=OperationRecord3D)
async def generate_cam_toolpath(request: GenerateToolpathRequest, response: Response):
    try:
        operation = cam_engine(
            request.setup,
            request.operation,
            cached_mesh_loader=server_cached_mesh_loader,
        )
        if operation._log_run_id is not None:
            response.headers["X-Toolpath-Run-Id"] = operation._log_run_id
        return operation
    except ValueError as exc:
        logger.exception(
            "CAM toolpath generation failed operation_id=%s type=%s",
            request.operation.id,
            request.operation.type,
        )
        raise HTTPException(status_code=400, detail=f"{type(exc).__name__}: {exc}") from exc
    except NotImplementedError as exc:
        logger.exception(
            "CAM toolpath generation is not implemented operation_id=%s type=%s",
            request.operation.id,
            request.operation.type,
        )
        raise HTTPException(status_code=501, detail=f"{type(exc).__name__}: {exc}") from exc
    except Exception:
        logger.exception(
            "Unhandled CAM toolpath generation failure operation_id=%s type=%s",
            request.operation.id,
            request.operation.type,
        )
        raise
