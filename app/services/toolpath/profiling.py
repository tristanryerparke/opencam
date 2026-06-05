from typing import Literal

from shapely.geometry import Polygon

from app.schemas.models import ClosedPolyline, CutterLocationData, Path
from app.services.toolpath.base import BaseOperation


class ClosedProfilingEngine(BaseOperation):
    ring: ClosedPolyline
    side: Literal["outside", "inside"] = "outside"
    z_bounds: tuple[float, float]
    z_step_height: float
    stock_to_leave: float = 0

    def process(self) -> list[Path]:
        ring = self.ring.to_shapely()
        layer_heights = self.compute_layer_heights(
            self.z_bounds,
            self.z_step_height,
        )
        offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        if self.side == "inside":
            offset_distance = -offset_distance

        offset_ring = Polygon(ring).buffer(offset_distance, quad_segs=32).exterior.coords
        locations = [
            CutterLocationData(x=x, y=y, z=height)
            for height in layer_heights
            for x, y in offset_ring
        ]

        return self.build_paths_with_clearance(
            locations,
            cut_path_name="Closed profile",
        )
