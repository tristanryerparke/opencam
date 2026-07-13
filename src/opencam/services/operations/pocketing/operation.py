from __future__ import annotations

import time

import numpy as np
from shapely.geometry import Polygon

from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.cl_data import FeedRatePositionRecord3D, PositionRecord
from opencam.schemas.models import ClosedPolyline
from opencam.services.operations.base import BaseOperation
from opencam.services.operations.pocketing.geometry import PocketGeometryMixin
from opencam.services.operations.pocketing.paths import PocketPathMixin
from opencam.services.operations.pocketing.seams import PocketSeamMixin
from opencam.services.operations.pocketing.tree import PocketTreeMixin


class ClosedPocketingEngine(
    BaseOperation,
    PocketGeometryMixin,
    PocketSeamMixin,
    PocketTreeMixin,
    PocketPathMixin,
):
    ring: ClosedPolyline
    z_bounds: tuple[float, float]
    z_step_height: float
    stepover: float = 25.0
    stock_to_leave: float = 0

    def process(self) -> list[PositionRecord]:
        calculation_start = time.perf_counter()

        if self.stepover <= 0:
            raise ValueError("Stepover must be greater than 0%.")
        if self.stepover > 100:
            raise ValueError("Stepover must be 100% or less.")

        base_polyline = self.shift_seam_to_longest_straight_edge_near_initial_seam(
            validate_closed_polyline(self.ring.to_numpy())
        )
        layer_heights = self.compute_layer_heights(
            self.z_bounds,
            self.z_step_height,
        )

        ordered_nodes = self.build_ordered_pocket_nodes(base_polyline)
        if not ordered_nodes:
            raise ValueError(
                "Pocketing geometry is too small for the selected tool diameter and stock to leave."
            )

        pocket_center = self.polygon_center(Polygon(base_polyline))
        path_templates = self.build_cut_path_templates(
            ordered_nodes,
            pocket_center=pocket_center,
        )

        cut_records: list[list[FeedRatePositionRecord3D]] = []
        for height in layer_heights:
            for template in path_templates:
                cut_records.append(
                    self.coordinates_to_records(template.coordinates, height)
                )

        record_sequence = self.build_cut_record_sequence(cut_records)
        calculation_elapsed = time.perf_counter() - calculation_start
        print(
            f"[pocket/closed] Calculated closed pocketing operation in {calculation_elapsed:.3f}s "
            f"({len(record_sequence)} records)."
        )
        return record_sequence

    def coordinates_to_records(
        self,
        coordinates: np.ndarray,
        z_height: float,
    ) -> list[FeedRatePositionRecord3D]:
        return [
            FeedRatePositionRecord3D(x=float(x), y=float(y), z=z_height, feedrate=self.feedrate)
            for x, y in coordinates
        ]
