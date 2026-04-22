from typing import Literal

import math
import numpy as np
from op import BaseOperation
from shapely.geometry import Polygon

from models import ClosedPolyline, CutterLocationData, Path


class ClosedProfilingEngine(BaseOperation):
    ring: ClosedPolyline
    side: Literal["outside", "inside"] = "outside"
    z_bounds: tuple[float, float]
    z_step_height: float
    stock_to_leave: float = 0

    def process(self):
        ring = self.ring.to_shapely()
        top_z = max(self.z_bounds)
        bottom_z = min(self.z_bounds)
        depth_of_cut = top_z - bottom_z
        intervals = max(1, math.ceil(depth_of_cut / self.z_step_height))
        layer_heights = list(np.linspace(top_z, bottom_z, intervals + 1))
        offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        if self.side == "inside":
            offset_distance = -offset_distance

        offset_ring = Polygon(ring).buffer(offset_distance, quad_segs=32).exterior.coords
        locations = [
            CutterLocationData(x=x, y=y, z=height)
            for height in layer_heights
            for x, y in offset_ring
        ]

        return Path(locations=locations)
