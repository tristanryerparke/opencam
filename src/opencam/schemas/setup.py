from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.operations.base import (
    AbsoluteClearance,
    BaseCAMOperation,
    PartMaxZPlusOffsetClearance,
    StockMaxZPlusOffsetClearance,
    ui_metadata,
)


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


class CAMSetup(CamelBaseModel):
    model_config = ConfigDict(title="CAMSetup", json_schema_extra=ui_metadata(hidden=True))

    origin: SetupOrigin = Field(default_factory=SetupOrigin, title="Origin")
    orientation: SetupOrientation = Field(default_factory=SetupOrientation, title="Orientation")
    stock: SetupStock = Field(default_factory=SetupStock, title="Stock")

    def clearance_height(self, operation: BaseCAMOperation) -> float:
        clearance = operation.clearance
        if isinstance(clearance, AbsoluteClearance):
            return clearance.absolute_height
        if isinstance(clearance, StockMaxZPlusOffsetClearance):
            return self.stock.max_z + clearance.offset
        if isinstance(clearance, PartMaxZPlusOffsetClearance):
            return operation.max_cut_z() + clearance.offset
        raise ValueError("Unsupported clearance height type.")  # pragma: no cover
