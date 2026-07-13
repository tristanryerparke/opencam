from typing import Literal

import numpy as np
from shapely.geometry import LinearRing

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import PositionRecord3D


class Tool(CamelBaseModel):
    diameter: float
    cutting_height: float
    num_flutes: float = 2


class Point2D(CamelBaseModel):
    x: float
    y: float


class ClosedPolyline(CamelBaseModel):
    vertices: list[Point2D]

    def to_shapely(self):
        return LinearRing([(vertex.x, vertex.y) for vertex in self.vertices])

    def to_numpy(self):
        vertices = np.array(
            [(vertex.x, vertex.y) for vertex in self.vertices],
            dtype=np.float64,
        )
        if vertices.size == 0:
            return vertices.reshape((0, 2))
        if not np.array_equal(vertices[0], vertices[-1]):
            vertices = np.vstack((vertices, vertices[0]))
        return np.ascontiguousarray(vertices)


class SweptSimulationResponse(CamelBaseModel):
    active_mesh_url: str
    cached_mesh_url: str
    simulation_id: str
    frame_count: int
    chunk_count: int
    chunk_index: int
    tool_mesh_url: str
    tool_position: PositionRecord3D


class SweptSimulationFrameResponse(CamelBaseModel):
    active_mesh_url: str
    cached_mesh_url: str
    chunk_index: int
    tool_position: PositionRecord3D


class SweptSimulationFramesResponse(CamelBaseModel):
    start_index: int
    frames: list[SweptSimulationFrameResponse]


class SweptSimulationStartResponse(CamelBaseModel):
    task_id: str


class SweptSimulationStatusResponse(CamelBaseModel):
    task_id: str
    status: Literal["queued", "running", "cancelling", "completed", "cancelled", "error"]
    progress_percent: float
    message: str | None = None
    error_detail: str | None = None
    result: SweptSimulationResponse | None = None
