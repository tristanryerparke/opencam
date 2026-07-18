from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata


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
        geometry_zs = [area.z for area in self.drive_geometry.cut_areas]
        if self.levels.drive_geometry_position == "at_top":
            return max(geometry_zs)
        return max(z + self.levels.depth_of_cut for z in geometry_zs)
 