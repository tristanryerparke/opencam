from typing import Literal

from pydantic import field_validator
from opencam_contracts.base import CamelBaseModel

POLYLINE_SIMPLIFICATION_TOLERANCE = 0.001


class Point2D(CamelBaseModel):
    x: float
    y: float


class Polyline2D(CamelBaseModel):
    kind: Literal["polyline"] = "polyline"
    vertices: list[Point2D]

    def _raw_numpy(self):
        import numpy as np

        vertices = np.array(
            [(vertex.x, vertex.y) for vertex in self.vertices],
            dtype=np.float64,
        )
        if vertices.size == 0:
            return vertices.reshape((0, 2))
        return np.ascontiguousarray(vertices)

    def to_numpy(self):
        import numpy as np
        from shapely.geometry import LineString

        vertices = self._raw_numpy()
        if len(vertices) < 3:
            return vertices
        simplified = LineString(vertices).simplify(
            POLYLINE_SIMPLIFICATION_TOLERANCE,
            preserve_topology=True,
        )
        return np.ascontiguousarray(simplified.coords, dtype=np.float64)

    def to_shapely(self):
        from shapely.geometry import LinearRing

        return LinearRing([(vertex.x, vertex.y) for vertex in self.vertices])


class ClosedPolyline2D(Polyline2D):
    kind: Literal["closed_polyline"] = "closed_polyline"

    @field_validator("vertices")
    @classmethod
    def validate_vertices_closed(cls, vertices: list[Point2D]) -> list[Point2D]:
        if vertices and vertices[0] != vertices[-1]:
            raise ValueError("Expected a closed polyline where the first and last vertices are equal.")
        return vertices

    def to_numpy(self):
        from opencam.engine.closed_polyline.cleanup import dedup, simplify

        vertices = self._raw_numpy()
        return simplify(
            dedup(vertices, tolerance=POLYLINE_SIMPLIFICATION_TOLERANCE),
            tolerance=POLYLINE_SIMPLIFICATION_TOLERANCE,
        )
