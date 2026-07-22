from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.mesh import CachedMesh, Mesh
from opencam.schemas.operations.base import DEFAULT_CLEARANCE_OFFSET, ui_metadata


class SetupOrigin(CamelBaseModel):
    x: float = Field(0.0, title="Origin X", json_schema_extra=ui_metadata(unit="mm"))
    y: float = Field(0.0, title="Origin Y", json_schema_extra=ui_metadata(unit="mm"))
    z: float = Field(0.0, title="Origin Z", json_schema_extra=ui_metadata(unit="mm"))


class SetupOrientation(CamelBaseModel):
    machine_z_axis: Literal["positiveZ"] = Field(
        default="positiveZ",
        title="Machine Z axis",
        description="Current UI assumes a normally oriented setup with machine Z pointing up.",
    )


class SetupStock(CamelBaseModel):
    max_z: float = Field(
        default=0.0,
        title="Stock max Z",
        description="Used when clearance height is computed from stock height.",
        json_schema_extra=ui_metadata(unit="mm"),
    )


class CAMSetup(CamelBaseModel):
    model_config = ConfigDict(title="CAMSetup")

    part_mesh: Mesh | CachedMesh | None = Field(
        default=None,
        discriminator="source",
        title="Part mesh",
    )
    clearance_offset: float = Field(
        default=DEFAULT_CLEARANCE_OFFSET,
        ge=0,
        title="Automatic clearance offset",
        json_schema_extra=ui_metadata(unit="mm"),
    )
    origin: SetupOrigin = Field(default_factory=SetupOrigin, title="Origin")
    orientation: SetupOrientation = Field(default_factory=SetupOrientation, title="Orientation")
    stock: SetupStock = Field(default_factory=SetupStock, title="Stock")
