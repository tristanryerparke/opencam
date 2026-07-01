from __future__ import annotations

import time

import numpy as np
from shapely.geometry import Polygon

import opencam.engine.closed_polyline as cp
from opencam.schemas.models import ClosedPolyline, CutterLocationData, Path
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

    def process(self) -> list[Path]:
        calculation_start = time.perf_counter()

        if self.stepover <= 0:
            raise ValueError("Stepover must be greater than 0%.")
        if self.stepover > 100:
            raise ValueError("Stepover must be 100% or less.")

        base_polyline = self.shift_seam_to_longest_straight_edge_near_initial_seam(
            cp.validate_closed_polyline(self.ring.to_numpy())
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

        cut_paths: list[Path] = []
        for layer_index, height in enumerate(layer_heights, start=1):
            for branch_index, template in enumerate(path_templates, start=1):
                cut_paths.append(
                    Path(
                        name=f"Pocket path L{layer_index} B{branch_index}",
                        kind="cut",
                        locations=self.coordinates_to_locations(
                            template.coordinates,
                            height,
                        ),
                    )
                )

        path_sequence = self.build_cut_path_sequence(cut_paths)
        calculation_elapsed = time.perf_counter() - calculation_start
        print(
            f"[pocket/closed] Calculated closed pocketing operation in {calculation_elapsed:.3f}s "
            f"({len(path_sequence)} paths)."
        )
        return path_sequence

    def coordinates_to_locations(
        self,
        coordinates: np.ndarray,
        z_height: float,
    ) -> list[CutterLocationData]:
        return [
            CutterLocationData(x=float(x), y=float(y), z=z_height)
            for x, y in coordinates
        ]
