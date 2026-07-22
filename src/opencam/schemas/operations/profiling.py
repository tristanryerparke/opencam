from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2_5d import ClosedPolyline25D, Polyline25D
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata


class ProfilingCutSettings(CamelBaseModel):
    side: Literal["outside", "inside"] = Field(default="outside", title="Side")
    cut_direction: Literal["climb", "conventional"] = Field(default="climb", title="Climb/Conventional")
    stock_to_leave: float = Field(default=0.0, ge=0, title="Stock to leave", json_schema_extra=ui_metadata(unit="mm"))


class Profiling2dOp(BaseCAMOperation):
    model_config = ConfigDict(title="Profiling2dOp")

    type: Literal["profiling_2d"] = Field(default="profiling_2d", frozen=True)
    display_name: str = Field(default="2D Profile", title="Operation name")
    drive_geometry: list[ClosedPolyline25D | Polyline25D] = Field(min_length=1, title="Drive geometry")
    cut_parameters: ProfilingCutSettings = Field(default_factory=ProfilingCutSettings, title="Cut parameters")
