from __future__ import annotations

from typing import Annotated

from pydantic import ConfigDict, Field, model_validator

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2d import ClosedPolyline2D
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.operations.profiling import Profiling2dOp
from opencam.schemas.setup import CAMSetup


class GenerateToolpathRequest(CamelBaseModel):
    model_config = ConfigDict(title="GenerateToolpathRequest")

    setup: CAMSetup = Field(default_factory=CAMSetup, title="Setup")
    operation: Pocketing2dOp | Profiling2dOp = Field(title="Operation", discriminator="type")

    @model_validator(mode="after")
    def validate_clearance_height(self) -> "GenerateToolpathRequest":
        if self.setup.clearance_height(self.operation) <= self.operation.max_cut_z():
            raise ValueError("Clearance height must be above the operation top Z.")
        return self


def build_frontend_cam_schema_bundle() -> dict[str, dict]:
    return {
        "generateToolpathRequest": GenerateToolpathRequest.model_json_schema(mode="validation"),
        "pocket2dOperation": Pocketing2dOp.model_json_schema(mode="validation"),
        "profile2dOperation": Profiling2dOp.model_json_schema(mode="validation"),
    }
