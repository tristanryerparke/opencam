from __future__ import annotations

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.tools import Tool


def ui_metadata(
    *,
    hidden: bool = False,
    unit: str | None = None,
    read_only: bool = False,
    widget: str | None = None,
) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if hidden:
        metadata["hidden"] = True
    if unit is not None:
        metadata["unit"] = unit
    if read_only:
        metadata["readOnly"] = True
    if widget is not None:
        metadata["widget"] = widget
    return {"x-opencam": metadata}


class FeedsAndSpeeds(CamelBaseModel):
    spindle_rpm: int = Field(default=12000, gt=0, title="Spindle RPM")
    plunge_feedrate: float = Field(default=250.0, gt=0, title="Plunge feedrate", json_schema_extra=ui_metadata(unit="mm/min"))
    lead_in_feedrate: float = Field(default=500.0, gt=0, title="Lead-in feedrate", json_schema_extra=ui_metadata(unit="mm/min"))
    cut_feedrate: float = Field(default=500.0, gt=0, title="Cut feedrate", json_schema_extra=ui_metadata(unit="mm/min"))
    lead_out_feedrate: float = Field(default=500.0, gt=0, title="Lead-out feedrate", json_schema_extra=ui_metadata(unit="mm/min"))
    departure_feedrate: float = Field(default=500.0, gt=0, title="Departure feedrate", json_schema_extra=ui_metadata(unit="mm/min"))


class Material(CamelBaseModel):
    """DB-backed material record."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1)


class StockMaxZPlusOffsetClearance(CamelBaseModel):
    clearance_height_type: Literal["stock_max_z_plus_offset"] = "stock_max_z_plus_offset"
    offset: float = Field(default=5.0, ge=0, title="Offset", json_schema_extra=ui_metadata(unit="mm"))


class PartMaxZPlusOffsetClearance(CamelBaseModel):
    clearance_height_type: Literal["part_max_z_plus_offset"] = "part_max_z_plus_offset"
    offset: float = Field(default=5.0, ge=0, title="Offset", json_schema_extra=ui_metadata(unit="mm"))


class AbsoluteClearance(CamelBaseModel):
    clearance_height_type: Literal["absolute"] = "absolute"
    absolute_height: float = Field(default=25.4, title="Absolute height", json_schema_extra=ui_metadata(unit="mm"))


ClearanceSettings = Annotated[
    AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance,
    Field(discriminator="clearance_height_type"),
]


class CAMLevels(CamelBaseModel):
    drive_geometry_position: Literal["at_top", "at_bottom"] = Field(default="at_top", title="Drive geometry at")
    depth_of_cut: float = Field(default=5.0, gt=0, title="Depth of cut", json_schema_extra=ui_metadata(unit="mm"))
    max_stepdown: float = Field(default=20.0, gt=0, title="Max stepdown", json_schema_extra=ui_metadata(unit="mm"))


class CAMAdvancedParameters(CamelBaseModel):
    operations_sorting: Literal["selection", "shortest_distance"] = Field(default="selection", title="Operation sorting")
    chordal_tolerance: float = Field(default=0.01, gt=0, title="Chordal tolerance", json_schema_extra=ui_metadata(unit="mm"))


class BaseCAMOperation(CamelBaseModel):
    type: str
    id: str = Field(default_factory=lambda: str(uuid4()), title="Operation ID", json_schema_extra=ui_metadata(hidden=True))
    display_name: str = Field(default="2D Pocket", title="Operation name", json_schema_extra=ui_metadata(hidden=True))
    tool: Tool = Field(title="Tool", json_schema_extra=ui_metadata(widget="tool-select"))
    feeds_and_speeds: FeedsAndSpeeds = Field(default_factory=FeedsAndSpeeds, title="Feeds and speeds")
    clearance: ClearanceSettings = Field(default_factory=AbsoluteClearance, title="Clearance")
    levels: CAMLevels = Field(default_factory=CAMLevels, title="Levels")
    advanced: CAMAdvancedParameters = Field(default_factory=CAMAdvancedParameters, title="Advanced")
