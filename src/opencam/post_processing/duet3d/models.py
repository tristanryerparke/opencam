from pydantic import Field

from opencam_contracts.base import CamelBaseModel
from opencam_contracts.cl_data import OperationRecord3D
from opencam_contracts.machine import (
    MachineAxisDefinition,
    MachineDefinition,
    MachineSpindleDefinition,
)


class Duet3DMachineDefinition(MachineDefinition):
    firmware_version: str | None = None


class Duet3DPostProcessRequest(CamelBaseModel):
    program_name: str = Field(default="OpenCAM program", min_length=1, max_length=200)
    machine: Duet3DMachineDefinition
    operations: list[OperationRecord3D] = Field(min_length=1)
    coordinate_precision: int = Field(default=3, ge=0, le=6)


def build_default_duet3d_machine() -> Duet3DMachineDefinition:
    """Placeholder three-axis machine used until machine definitions are persisted."""
    return Duet3DMachineDefinition(
        name="Duet 3D CNC",
        axes=[
            MachineAxisDefinition(letter="X", minimum_position=0, maximum_position=500, maximum_feedrate=6000),
            MachineAxisDefinition(letter="Y", minimum_position=0, maximum_position=500, maximum_feedrate=6000),
            MachineAxisDefinition(letter="Z", minimum_position=-100, maximum_position=100, maximum_feedrate=2000),
        ],
        spindle=MachineSpindleDefinition(minimum_rpm=6000, maximum_rpm=24000),
    )
