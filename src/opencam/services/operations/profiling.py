from typing import Literal

from shapely.geometry import Polygon

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.schemas.cl_data import FeedRatePositionRecord3D, PositionRecord
from opencam.schemas.models import ClosedPolyline
from opencam.services.operations.base import BaseOperation


class ClosedProfilingEngine(BaseOperation):
    ring: ClosedPolyline
    side: Literal["outside", "inside"] = "outside"
    z_bounds: tuple[float, float]
    z_step_height: float
    stock_to_leave: float = 0

    def process(self) -> list[PositionRecord]:
        ring = self.ring.to_shapely()
        layer_heights = self.compute_layer_heights(
            self.z_bounds,
            self.z_step_height,
        )
        offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        if self.side == "inside":
            offset_distance = -offset_distance

        offset_ring = (
            Polygon(ring)
            .buffer(
                offset_distance,
                quad_segs=quad_segs_for_tolerance(offset_distance),
            )
            .exterior.coords
        )
        records = [
            FeedRatePositionRecord3D(x=x, y=y, z=height, feedrate=self.feedrate)
            for height in layer_heights
            for x, y in offset_ring
        ]

        return self.build_records_with_clearance(records)
