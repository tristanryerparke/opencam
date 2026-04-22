from typing import Literal

from devtools import debug as d
import numpy as np
import uuid
from base import CamelBaseModel
from pydantic import Field
from shapely.geometry import LineString, LinearRing


class Tool(CamelBaseModel):
    diameter: float
    cutting_height: float
    max_depth_of_cut: float
    num_flutes: float = 2


class Point2D(CamelBaseModel):
    x: float
    y: float


class ClosedPolyline(CamelBaseModel):
    vertices: list[Point2D]

    def to_shapely(self):
        return LinearRing([(vertex.x, vertex.y) for vertex in self.vertices])


class CutterLocationData(CamelBaseModel):
    x: float
    y: float
    z: float
    comment: str | None = None

    def as_numpy(self):
        return np.array([self.x, self.y, self.z])


class Path(CamelBaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str | None = None
    kind: Literal["cut", "clearance"] = "cut"
    locations: list[CutterLocationData]

    def as_numpy(self):
        return np.array([loc.as_numpy() for loc in self.locations])

    def as_shapely(self):
        return LineString([(loc.x, loc.y, loc.z) for loc in self.locations])


class ToolpathOperation(CamelBaseModel):
    tool: Tool
    paths: list[Path]


if __name__ == "__main__":
    start = CutterLocationData(x=0, y=0, z=0, comment="start")
    end = CutterLocationData(x=10, y=5, z=-1)

    path = Path(name="demo path", locations=[start, end])

    d(path)
    print(path.as_numpy())
    print(path.as_shapely())
