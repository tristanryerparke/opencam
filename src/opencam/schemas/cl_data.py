from typing import Annotated, Literal
from pydantic import Field
from opencam.schemas.base import CamelBaseModel
from opencam.schemas.tools import Tool


class PositionRecord3D(CamelBaseModel):
    """Three-axis position data for translation into G-code by a post processor."""

    type: Literal["position_3d"] = Field(default="position_3d", frozen=True)
    x: float
    y: float
    z: float
    comment: str | None = None


class RapidPositionRecord3D(PositionRecord3D):
    feed_type: Literal["rapid"] = Field(default="rapid", frozen=True)


class FeedRatePositionRecord3D(PositionRecord3D):
    feed_type: Literal["feed_rate"] = Field(default="feed_rate", frozen=True)
    feedrate: float


PositionRecord = Annotated[
    RapidPositionRecord3D | FeedRatePositionRecord3D,
    Field(discriminator="feed_type"),
]


class OperationRecord3D(CamelBaseModel):
    "Holds a set of positional data as well as tool, comment and data"
    tool: Tool
    tool_axis: list[float] = Field(default_factory=lambda: [0.0, 0.0, 1.0])
    pre_comments: list[str] = Field(default_factory=list)
    post_comments: list[str] = Field(default_factory=list)
    clearance_plane_height: float
    records: list[PositionRecord]
