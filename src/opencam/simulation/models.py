from typing import Literal

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import PositionRecord3D


class SweptSimulationResponse(CamelBaseModel):
    active_mesh_url: str
    active_mesh_key: int
    cached_mesh_url: str
    simulation_id: str
    frame_count: int
    chunk_count: int
    chunk_index: int
    chunk_step_index: int | None
    chunk_step_count: int
    chunk_toolpath_points: list[PositionRecord3D]
    tool_mesh_url: str
    tool_position: PositionRecord3D


class SweptSimulationFrameResponse(CamelBaseModel):
    active_mesh_url: str
    active_mesh_key: int
    cached_mesh_url: str
    chunk_index: int
    chunk_step_index: int | None
    chunk_step_count: int
    chunk_toolpath_points: list[PositionRecord3D]
    tool_position: PositionRecord3D


class SweptSimulationFramesResponse(CamelBaseModel):
    start_index: int
    frames: list[SweptSimulationFrameResponse]


class SweptSimulationStartResponse(CamelBaseModel):
    task_id: str


class SweptSimulationComparisonResponse(CamelBaseModel):
    cached_mesh_url: str
    active_mesh_url: str


class SweptSimulationResampleRequest(CamelBaseModel):
    frame_step_distance: float
    rapid_frame_step_scale: float | None = None


class SweptSimulationStatusResponse(CamelBaseModel):
    task_id: str
    status: Literal["queued", "running", "cancelling", "completed", "cancelled", "error"]
    progress_percent: float
    message: str | None = None
    error_detail: str | None = None
    result: SweptSimulationResponse | None = None
