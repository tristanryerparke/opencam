from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2d import ClosedPolyline2D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata
from opencam.schemas.operations.pocketing import StepoverMode


class ParallelFinishingCutSettings(CamelBaseModel):
    cut_direction: Literal["climb", "conventional", "mixed"] = Field(
        default="mixed",
        title="Cut Style",
    )
    direction_degrees: float = Field(
        default=0.0,
        ge=0.0,
        lt=180.0,
        title="Slice Direction",
        description="Lane travel direction in degrees from +X. Stepover advances 90 degrees CCW.",
        json_schema_extra=ui_metadata(unit="degrees"),
    )
    stepover: StepoverMode = Field(default_factory=StepoverMode, title="Stepover")
    stock_to_leave: float = Field(
        default=0.0,
        ge=0.0,
        title="Stock to leave",
        json_schema_extra=ui_metadata(unit="mm"),
    )


class ParallelFinishingOp(BaseCAMOperation):
    model_config = ConfigDict(title="ParallelFinishingOp")

    type: Literal["parallel_finishing"] = Field(default="parallel_finishing", frozen=True)
    display_name: str = Field(default="Parallel Finishing", title="Operation name")

    drive_geometry: list[ClosedPolyline2D] = Field(min_length=1, title="Drive geometry")
    cut_parameters: ParallelFinishingCutSettings = Field(
        default_factory=ParallelFinishingCutSettings,
        title="Cut parameters",
    )
