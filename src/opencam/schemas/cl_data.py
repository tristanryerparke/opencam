from typing import Annotated, Literal

from pydantic import Field, PrivateAttr

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.tools import Tool


class PositionRecord3D(CamelBaseModel):
    """Three-axis position data for translation into G-code by a post processor."""

    type: Literal["position_3d"] = Field(default="position_3d", frozen=True)
    x: float
    y: float
    z: float
    comment: str | None = None
    motion_role: Literal["cutting", "linking", "travel"] = "cutting"


class RapidPositionRecord3D(PositionRecord3D):
    feed_type: Literal["rapid"] = Field(default="rapid", frozen=True)
    motion_role: Literal["travel"] = Field(default="travel", frozen=True)


class FeedRatePositionRecord3D(PositionRecord3D):
    feed_type: Literal["feed_rate"] = Field(default="feed_rate", frozen=True)
    motion_role: Literal["cutting", "linking"] = "cutting"
    feedrate: float


class ArcPositionRecord3D(PositionRecord3D):
    feed_type: Literal["arc"] = Field(default="arc", frozen=True)
    motion_role: Literal["cutting", "linking"] = "cutting"
    center_offset_x: float
    center_offset_y: float
    clockwise: bool
    feedrate: float


PositionRecord = Annotated[
    RapidPositionRecord3D | FeedRatePositionRecord3D | ArcPositionRecord3D,
    Field(discriminator="feed_type"),
]


class OperationRecord3D(CamelBaseModel):
    "Holds a set of positional data as well as tool, comment and data"

    _log_run_id: str | None = PrivateAttr(default=None)
    tool: Tool
    tool_axis: list[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    pre_comments: list[str] = Field(default_factory=list)
    post_comments: list[str] = Field(default_factory=list)
    spindle_rpm: int = Field(default=12000, gt=0)
    clearance_plane_height: float
    records: list[PositionRecord]
