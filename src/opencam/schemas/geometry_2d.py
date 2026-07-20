from typing import Literal

import numpy as np
from pydantic import field_validator
from shapely.geometry import LinearRing

from opencam.schemas.base import CamelBaseModel


class Point2D(CamelBaseModel):
    x: float
    y: float


class Polyline2D(CamelBaseModel):
    kind: Literal["polyline"] = "polyline"
    vertices: list[Point2D]

    def to_numpy(self):
        vertices = np.array(
            [(vertex.x, vertex.y) for vertex in self.vertices],
            dtype=np.float64,
        )
        if vertices.size == 0:
            return vertices.reshape((0, 2))
        return np.ascontiguousarray(vertices)

    def to_shapely(self):
        return LinearRing([(vertex.x, vertex.y) for vertex in self.vertices])


class ClosedPolyline2D(Polyline2D):
    kind: Literal["closed_polyline"] = "closed_polyline"

    @field_validator("vertices")
    @classmethod
    def validate_vertices_closed(cls, vertices: list[Point2D]) -> list[Point2D]:
        if vertices and vertices[0] != vertices[-1]:
            raise ValueError("Expected a closed polyline where the first and last vertices are equal.")
        return vertices
