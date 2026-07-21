from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import (
    build_cut_record_sequence,
    duplicate_layers_at_heights,
    stitch_geometry_records,
)
from opencam.engine.profiling.layer import build_profile_layers
from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.geometry_2_5d import ClosedPolyline25D, Polyline25D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata
from opencam.schemas.tools import BallTool, CylindricalTool


class ProfilingDriveGeometry(CamelBaseModel):
    profiles: list[ClosedPolyline25D | Polyline25D] = Field(min_length=1, title="Profiles")


class ProfilingCutSettings(CamelBaseModel):
    side: Literal["outside", "inside"] = Field(default="outside", title="Side")
    cut_direction: Literal["climb", "conventional"] = Field(default="climb", title="Climb/Conventional")
    stock_to_leave: float = Field(default=0.0, ge=0, title="Stock to leave", json_schema_extra=ui_metadata(unit="mm"))


class Profiling2dOp(BaseCAMOperation):
    model_config = ConfigDict(title="Profiling2dOp")

    type: Literal["profiling_2d"] = Field(default="profiling_2d", frozen=True)
    display_name: str = Field(default="2D Profile", title="Operation name")
    drive_geometry: ProfilingDriveGeometry = Field(title="Drive geometry")
    cut_parameters: ProfilingCutSettings = Field(default_factory=ProfilingCutSettings, title="Cut parameters")

    def max_cut_z(self) -> float:
        return self.levels.max_cut_z(profile.z for profile in self.drive_geometry.profiles)

    def build_records(self, *, clearance_plane_height: float) -> list[PositionRecord]:
        if not isinstance(self.tool, (CylindricalTool, BallTool)):
            raise NotImplementedError(f"Tool type {self.tool.type!r} is not supported for operation generation.")

        record_groups: list[list[PositionRecord]] = []
        for geometry in self.drive_geometry.profiles:
            layers = build_profile_layers(
                geometry,
                tool_diameter=self.tool.diameter,
                stock_to_leave=self.cut_parameters.stock_to_leave,
                side=self.cut_parameters.side,
                chord_tolerance=self.advanced.chordal_tolerance,
            )
            if not layers:
                raise ValueError("Profiling geometry is too small for the selected tool diameter and stock to leave.")

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
