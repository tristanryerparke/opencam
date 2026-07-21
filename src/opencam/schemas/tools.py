from typing import Annotated, Literal, TypeAlias
from uuid import uuid4

from pydantic import Field

from opencam.schemas.base import CamelBaseModel


class BaseTool(CamelBaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    name: str
    tool_number: int
    manual_change: bool = False
    diameter: float
    cutting_height: float
    shoulder_height: float
    num_flutes: float = 2


class CylindricalTool(BaseTool):
    type: Literal["cylinder"] = Field(default="cylinder", frozen=True)


class BallTool(BaseTool):
    type: Literal["ball"] = Field(default="ball", frozen=True)


class VTool(BaseTool):
    type: Literal["v"] = Field(default="v", frozen=True)
    tip_angle: float


Tool: TypeAlias = Annotated[
    CylindricalTool | BallTool | VTool,
    Field(discriminator="type"),
]
