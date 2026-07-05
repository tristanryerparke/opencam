from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import Field

from opencam.schemas.base import CamelBaseModel


class FeedsAndSpeeds(CamelBaseModel):
    spindle_rpm: int
    plunge_feedrate: float
    lead_in_feedrate: float
    cut_feedrate: float
    lead_out_feedrate: float
    departure_feedrate: float


class Material(CamelBaseModel):
    """DB-backed material record."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str


class Tool(CamelBaseModel):
    """DB-backed cutting tool record."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1)
    diameter: float
    flute_length: float
    shoulder_length: float
    tool_number: int | Literal["manual"]


class ToolMaterialFeedsAndSpeeds(CamelBaseModel):
    """DB row for feeds/speeds for a specific tool cutting a specific material."""

    id: str = Field(default_factory=lambda: str(uuid4()))
    tool_id: str
    material_id: str
    feeds_and_speeds: FeedsAndSpeeds
