from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata
from opencam.schemas.operations.pocketing import StepoverMode


class FacingCutSettings(CamelBaseModel):
    cut_direction: Literal["climb", "conventional", "mixed"] = Field(
        default="mixed", title="Cut direction"
    )
    stepover: StepoverMode = Field(default_factory=StepoverMode, title="Stepover")
    direction_degrees: float = Field(
        default=0.0,
        ge=0.0,
        lt=180.0,
        title="Pass angle",
        description="Angle of cutting passes measured counterclockwise from the X axis.",
        json_schema_extra=ui_metadata(unit="degrees"),
    )
    edge_overtravel: float = Field(
        default=0.0,
        ge=0,
        title="Edge overtravel",
        description="Additional cutter-center travel beyond each side and corner.",
        json_schema_extra=ui_metadata(unit="mm"),
    )


class Facing2dOp(BaseCAMOperation):
    model_config = ConfigDict(title="Facing2dOp")

    type: Literal["facing_2d"] = Field(default="facing_2d", frozen=True)
    display_name: str = Field(default="2.5D Facing", title="Operation name")
    drive_geometry: list[ClosedPolyline25D] = Field(
        min_length=1,
        max_length=1,
        title="Face boundary",
    )
    cut_parameters: FacingCutSettings = Field(
        default_factory=FacingCutSettings, title="Cut parameters"
    )
