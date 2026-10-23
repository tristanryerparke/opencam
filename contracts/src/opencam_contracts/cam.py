from __future__ import annotations

from typing import Union

from pydantic import ConfigDict, Field, model_validator

from opencam_contracts.base import CamelBaseModel
from opencam_contracts.operations.facing import Facing2dOp
from opencam_contracts.operations.parallel_finishing import ParallelFinishingOp
from opencam_contracts.operations.pocketing import Pocketing2dOp
from opencam_contracts.operations.profiling import Profiling2dOp
from opencam_contracts.setup import CAMSetup


class GenerateToolpathRequest(CamelBaseModel):
    model_config = ConfigDict(title="GenerateToolpathRequest")

    setup: CAMSetup = Field(default_factory=CAMSetup, title="Setup")
    operation: Union[Pocketing2dOp, Profiling2dOp, Facing2dOp, ParallelFinishingOp] = Field(
        title="Operation", discriminator="type"
    )

    @model_validator(mode="after")
    def validate_setup(self) -> GenerateToolpathRequest:
        if isinstance(self.operation, ParallelFinishingOp) and self.setup.part_mesh is None:
            raise ValueError("Parallel finishing requires a part mesh in the CAM setup.")
        return self


def build_frontend_cam_schema_bundle() -> dict[str, dict]:
    return {
        "generateToolpathRequest": GenerateToolpathRequest.model_json_schema(mode="validation"),
        "pocket2dOperation": Pocketing2dOp.model_json_schema(mode="validation"),
        "profile2dOperation": Profiling2dOp.model_json_schema(mode="validation"),
        "facing2dOperation": Facing2dOp.model_json_schema(mode="validation"),
        "parallelFinishingOperation": ParallelFinishingOp.model_json_schema(mode="validation"),
    }
