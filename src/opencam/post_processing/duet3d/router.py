from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse

from opencam.post_processing.duet3d.models import Duet3DPostProcessRequest
from opencam.post_processing.duet3d.post_processor import Duet3DPostProcessor
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
