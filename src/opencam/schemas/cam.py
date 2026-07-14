from __future__ import annotations

from pydantic import ConfigDict, Field, model_validator

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2d import ClosedPolyline2D
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.setup import CAMSetup


MachiningOperation = Pocketing2dOp


class GenerateToolpathRequest(CamelBaseModel):
    model_config = ConfigDict(title="GenerateToolpathRequest")

    setup: CAMSetup = Field(default_factory=CAMSetup, title="Setup")
    operation: MachiningOperation = Field(title="Operation")

    @model_validator(mode="after")
    def validate_clearance_height(self) -> "GenerateToolpathRequest":
        if self.setup.clearance_height(self.operation) <= self.operation.max_cut_z():
            raise ValueError("Clearance height must be above the operation top Z.")
        return self

    def to_closed_polylines(self) -> list[ClosedPolyline2D]:
        return [
            ClosedPolyline2D(vertices=area.vertices)
            for area in self.operation.drive_geometry.cut_areas
        ]


def build_frontend_cam_schema_bundle() -> dict[str, dict]:
    return {
        "generateToolpathRequest": GenerateToolpathRequest.model_json_schema(mode="validation"),
        "pocket2dOperation": Pocketing2dOp.model_json_schema(mode="validation"),
    }
