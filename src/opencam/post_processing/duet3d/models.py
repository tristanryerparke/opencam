from pydantic import Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import OperationRecord3D
from opencam.schemas.machine import MachineDefinition


class Duet3DMachineDefinition(MachineDefinition):
    firmware_version: str | None = None


class Duet3DPostProcessRequest(CamelBaseModel):
    program_name: str = Field(default="OpenCAM program", min_length=1, max_length=200)
    machine: Duet3DMachineDefinition
    operations: list[OperationRecord3D] = Field(min_length=1)
    coordinate_precision: int = Field(default=3, ge=0, le=6)
