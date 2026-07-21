from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import (
    build_cut_record_sequence,
    duplicate_layers_at_heights,
    stitch_geometry_records,
)
from opencam.engine.pocketing.layer import build_pocket_layers
from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata
from opencam.schemas.tools import BallTool, CylindricalTool


class StepoverMode(CamelBaseModel):
    mode: Literal["percentage_of_tool_diameter", "absolute"] = Field(default="percentage_of_tool_diameter", title="Mode")
    value: float = Field(default=25.0, gt=0, title="Value", json_schema_extra=ui_metadata(unit="%"))


class PocketingDriveGeometry(CamelBaseModel):
    cut_areas: list[ClosedPolyline25D] = Field(min_length=1, title="Cut areas")


class PocketingCutSettings(CamelBaseModel):
    cut_direction: Literal["climb", "conventional"] = Field(default="climb", title="Climb/Conventional")
    stepover: StepoverMode = Field(default_factory=StepoverMode, title="Stepover")
    stock_to_leave: float = Field(default=0.0, ge=0, title="Stock to leave", json_schema_extra=ui_metadata(unit="mm"))


class Pocketing2dOp(BaseCAMOperation):
    model_config = ConfigDict(title="Pocketing2dOp")

    type: Literal["pocketing_2d"] = Field(default="pocketing_2d", frozen=True)
    drive_geometry: PocketingDriveGeometry = Field(title="Drive geometry")
    cut_parameters: PocketingCutSettings = Field(default_factory=PocketingCutSettings, title="Cut parameters")

    def max_cut_z(self) -> float:
        return self.levels.max_cut_z(area.z for area in self.drive_geometry.cut_areas)

    def build_records(self, *, clearance_plane_height: float) -> list[PositionRecord]:
        if not isinstance(self.tool, (CylindricalTool, BallTool)):
            raise NotImplementedError(f"Tool type {self.tool.type!r} is not supported for operation generation.")

        stepover = self.cut_parameters.stepover
        stepover_percent = stepover.value
        if stepover.mode == "absolute":
            stepover_percent = stepover.value / self.tool.diameter * 100

        record_groups: list[list[PositionRecord]] = []
        for geometry in self.drive_geometry.cut_areas:
            layers = build_pocket_layers(
                geometry.to_numpy(),
                tool_diameter=self.tool.diameter,
                stepover_percent=stepover_percent,
                stock_to_leave=self.cut_parameters.stock_to_leave,
                chord_tolerance=self.advanced.chordal_tolerance,
            )
            if not layers:
                raise ValueError("Pocketing geometry is too small for the selected tool diameter and stock to leave.")

            cut_layers = duplicate_layers_at_heights(
                layers,
                compute_layer_heights(
                    self.levels.z_bounds(geometry.z),
                    self.levels.max_stepdown,
                ),
                feedrate=self.feeds_and_speeds.cut_feedrate,
            )
            record_groups.append(
                build_cut_record_sequence(
                    cut_layers,
                    clearance_plane_height=clearance_plane_height,
                )
            )

        return stitch_geometry_records(record_groups)
 