from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.mesh import Mesh


class MachineAxisDefinition(CamelBaseModel):
    letter: Literal["X", "Y", "Z"]
    minimum_position: float
    maximum_position: float
    maximum_feedrate: float | None = None


class MachineSpindleDefinition(CamelBaseModel):
    minimum_rpm: int
    maximum_rpm: int


class MachineDisplayMesh(CamelBaseModel):
    name: str = Field(min_length=1)
    mesh: Mesh
    moving_axis: Literal["static", "X", "Y", "Z"] = "static"
    translation: tuple[float, float, float] = (0.0, 0.0, 0.0)
    rotation_degrees: tuple[float, float, float] = (0.0, 0.0, 0.0)
    color: str | None = None


class MachineDefinition(CamelBaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str = Field(min_length=1)
    units: Literal["mm"] = "mm"
    axes: list[MachineAxisDefinition]
    spindle: MachineSpindleDefinition
    display_meshes: list[MachineDisplayMesh] = Field(default_factory=list)
