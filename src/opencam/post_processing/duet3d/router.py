from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse

from opencam.post_processing.duet3d.models import (
    Duet3DPostProcessRequest,
    build_default_duet3d_machine,
)
from opencam.post_processing.duet3d.post_processor import Duet3DPostProcessor
from opencam.schemas.cl_data import OperationRecord3D
from opencam.services.tool_library import ToolLibrary, get_tool_library

router = APIRouter(prefix="/cam/post-process/duet3d", tags=["post-processing"])


@router.post("", response_class=PlainTextResponse)
def post_process_duet3d(
    request: Duet3DPostProcessRequest,
    tool_library: ToolLibrary = Depends(get_tool_library),
):
    try:
        post_processor = Duet3DPostProcessor(
            request.machine,
            tool_library,
            coordinate_precision=request.coordinate_precision,
        )
        return post_processor.post_process(
            request.operations,
            program_name=request.program_name,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.post("/nc", response_class=PlainTextResponse)
def post_process_duet3d_nc(
    operations: list[OperationRecord3D],
    tool_library: ToolLibrary = Depends(get_tool_library),
):
    """Post-process stored cutter-location records into an `.nc` download."""
    try:
        post_processor = Duet3DPostProcessor(build_default_duet3d_machine(), tool_library)
        gcode = post_processor.post_process(operations)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    return PlainTextResponse(
        gcode,
        media_type="text/plain",
        headers={"Content-Disposition": 'attachment; filename="opencam.nc"'},
    )
