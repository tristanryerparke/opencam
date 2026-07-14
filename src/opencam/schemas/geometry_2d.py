import numpy as np
from shapely.geometry import LinearRing

from opencam.schemas.base import CamelBaseModel


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
