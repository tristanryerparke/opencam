from datetime import datetime

from fastapi import Depends, FastAPI, File, HTTPException, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from opencam.schemas.cam import GenerateToolpathRequest
from opencam.schemas.cl_data import OperationRecord3D
from opencam.schemas.operations.base import Material
from opencam.schemas.tools import Tool, ToolInput
from opencam.services.cam_engine import cam_engine
from opencam.services.mesh_cache import CachedMeshMetadata, get_mesh_cache
from opencam.services.tool_mesh import build_tool
from opencam.simulation.router import router as simulation_router
from opencam.services.tool_library import ToolLibrary, get_tool_library

app = FastAPI(title="OpenCAM API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(simulation_router)



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
def add_tool(tool: ToolInput, tool_library: ToolLibrary = Depends(get_tool_library)):
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
def update_tool(tool_id: str, tool: ToolInput, tool_library: ToolLibrary = Depends(get_tool_library)):
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


@app.get("/cam/materials", response_model=list[Material])
def list_materials(tool_library: ToolLibrary = Depends(get_tool_library)):
    return tool_library.list_materials()


@app.post("/cam/materials", response_model=Material, status_code=status.HTTP_201_CREATED)
def add_material(material: Material, tool_library: ToolLibrary = Depends(get_tool_library)):
    try:
        return tool_library.add_material(material)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@app.get("/cam/materials/{material_id}", response_model=Material)
def get_material(material_id: str, tool_library: ToolLibrary = Depends(get_tool_library)):
    material = tool_library.get_material(material_id)
    if material is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Material not found.")
    return material


@app.get("/cam/mesh", response_model=CachedMeshMetadata)
def get_cached_mesh_metadata():
    metadata = get_mesh_cache().get_metadata()
    if metadata is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mesh not found.")
    return metadata


@app.post("/cam/mesh", response_model=CachedMeshMetadata, status_code=status.HTTP_201_CREATED)
async def cache_mesh(mesh: UploadFile = File(...)):
    mesh_bytes = await mesh.read()
    try:
        return get_mesh_cache().set_mesh(
            mesh.filename or "mesh.stl",
            mesh_bytes,
            content_type=mesh.content_type,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@app.get("/cam/mesh/file")
def get_cached_mesh_file():
    cached_mesh = get_mesh_cache().get_mesh()
    if cached_mesh is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mesh not found.")
    return Response(content=cached_mesh.mesh_bytes, media_type=cached_mesh.content_type)


@app.delete("/cam/mesh", status_code=status.HTTP_204_NO_CONTENT)
def clear_cached_mesh():
    get_mesh_cache().clear()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.post("/cam/toolpath", response_model=OperationRecord3D)
async def generate_cam_toolpath(request: GenerateToolpathRequest):
    try:
        operation = cam_engine(request.setup, request.operation)
        return operation
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except NotImplementedError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
