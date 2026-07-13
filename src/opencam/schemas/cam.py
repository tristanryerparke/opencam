from __future__ import annotations

from typing import Annotated, Literal

from pydantic import ConfigDict, Field, model_validator

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.models import ClosedPolyline
from opencam.schemas.operations.base import (
    AbsoluteClearance,
    PartMaxZPlusOffsetClearance,
    StockMaxZPlusOffsetClearance,
    ui_metadata,
)
from opencam.schemas.operations.pocketing import ClosedCurveSelection, Pocket2DOperationConfig


class SetupOrigin(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=ui_metadata(hidden=True))

    x: float = Field(0.0, title="Origin X", json_schema_extra=ui_metadata(unit="mm"))
    y: float = Field(0.0, title="Origin Y", json_schema_extra=ui_metadata(unit="mm"))
    z: float = Field(0.0, title="Origin Z", json_schema_extra=ui_metadata(unit="mm"))


class SetupOrientation(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=ui_metadata(hidden=True))

    machine_z_axis: Literal["positiveZ"] = Field(
        default="positiveZ",
        title="Machine Z axis",
        description="Current UI assumes a normally oriented setup with machine Z pointing up.",
    )


class SetupStock(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=ui_metadata(hidden=True))

    max_z: float = Field(
        default=0.0,
        title="Stock max Z",
        description="Used when clearance height is computed from stock height.",
        json_schema_extra=ui_metadata(unit="mm"),
    )


class CamSetupConfig(CamelBaseModel):
    model_config = ConfigDict(title="CamSetupConfig", json_schema_extra=ui_metadata(hidden=True))

    origin: SetupOrigin = Field(default_factory=SetupOrigin, title="Origin")
    orientation: SetupOrientation = Field(default_factory=SetupOrientation, title="Orientation")
    stock: SetupStock = Field(default_factory=SetupStock, title="Stock")


MachiningOperation = Annotated[Pocket2DOperationConfig, Field(discriminator="kind")]


class GenerateToolpathRequest(CamelBaseModel):
    model_config = ConfigDict(title="GenerateToolpathRequest")

    setup: CamSetupConfig = Field(default_factory=CamSetupConfig, title="Setup")
    operation: MachiningOperation = Field(title="Operation")

    def clearance_height(self) -> float:
        clearance = self.operation.clearance
        if isinstance(clearance, AbsoluteClearance):
            return clearance.absolute_height
        if isinstance(clearance, StockMaxZPlusOffsetClearance):
            return self.setup.stock.max_z + clearance.offset
        if isinstance(clearance, PartMaxZPlusOffsetClearance):
            # ponytail: uses selected geometry; use the model's max Z when the setup carries it.
            return max(area.plane_z for area in self.operation.drive_geometry.cut_areas) + clearance.offset
        raise ValueError("Unsupported clearance height type.")  # pragma: no cover - exhaustive discriminated union

    @model_validator(mode="after")
    def validate_clearance_height(self) -> "GenerateToolpathRequest":
        if self.clearance_height() <= self.operation.max_cut_z():
            raise ValueError("Clearance height must be above the operation top Z.")

        return self

    def to_closed_polylines(self) -> list[ClosedPolyline]:
        return [
            ClosedPolyline(vertices=area.vertices)
            for area in self.operation.drive_geometry.cut_areas
        ]


def build_frontend_cam_schema_bundle() -> dict[str, dict]:
    return {
        "generateToolpathRequest": GenerateToolpathRequest.model_json_schema(mode="validation"),
        "pocket2dOperation": Pocket2DOperationConfig.model_json_schema(mode="validation"),
    }
