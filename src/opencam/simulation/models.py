from typing import Literal

from opencam_contracts.base import CamelBaseModel
from opencam_contracts.cl_data import PositionRecord3D


class SimulationFrameMapping(CamelBaseModel):
    tool_position: PositionRecord3D
    active_mesh_index: int
    cl_record_index: int


class SimulationChunkMapping(CamelBaseModel):
    cached_mesh_url: str
    frames: list[SimulationFrameMapping]


class SweptSimulationResponse(CamelBaseModel):
    simulation_id: str
    frame_count: int
    chunk_count: int
    tool_mesh_url: str
    final_mesh_url: str
    chunks: list[SimulationChunkMapping]


class SweptSimulationStartResponse(CamelBaseModel):
    task_id: str


class SweptSimulationComparisonResponse(CamelBaseModel):
    cached_mesh_url: str
    active_mesh_url: str


class SweptSimulationStatusResponse(CamelBaseModel):
    task_id: str
    status: Literal["queued", "running", "cancelling", "completed", "cancelled", "error"]
    progress_percent: float
    message: str | None = None
    error_detail: str | None = None
    result: SweptSimulationResponse | None = None
