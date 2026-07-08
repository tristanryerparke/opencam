from __future__ import annotations

from typing import Annotated, Literal
from uuid import uuid4

from pydantic import ConfigDict, Field, model_validator

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.models import ClosedPolyline, Point2D


def _ui_metadata(*, hidden: bool = False, unit: str | None = None, read_only: bool = False) -> dict[str, object]:
    metadata: dict[str, object] = {}
    if hidden:
        metadata["hidden"] = True
    if unit is not None:
        metadata["unit"] = unit
    if read_only:
        metadata["readOnly"] = True
    return {"x-opencam": metadata}


class SetupOrigin(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=_ui_metadata(hidden=True))

    x: float = Field(0.0, title="Origin X", json_schema_extra=_ui_metadata(unit="mm"))
    y: float = Field(0.0, title="Origin Y", json_schema_extra=_ui_metadata(unit="mm"))
    z: float = Field(0.0, title="Origin Z", json_schema_extra=_ui_metadata(unit="mm"))


class SetupOrientation(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=_ui_metadata(hidden=True))

    machine_z_axis: Literal["positiveZ"] = Field(
        default="positiveZ",
        title="Machine Z axis",
        description="Current UI assumes a normally oriented setup with machine Z pointing up.",
    )


class SetupStock(CamelBaseModel):
    model_config = ConfigDict(json_schema_extra=_ui_metadata(hidden=True))

    max_z: float = Field(
        default=0.0,
        title="Stock max Z",
        description="Used when transfer height is computed from stock height.",
        json_schema_extra=_ui_metadata(unit="mm"),
    )


class CamSetupConfig(CamelBaseModel):
    model_config = ConfigDict(
        title="CamSetupConfig",
        json_schema_extra=_ui_metadata(hidden=True),
    )

    origin: SetupOrigin = Field(default_factory=SetupOrigin, title="Origin")
    orientation: SetupOrientation = Field(default_factory=SetupOrientation, title="Orientation")
    stock: SetupStock = Field(default_factory=SetupStock, title="Stock")


class ClosedCurveSelection(CamelBaseModel):
    model_config = ConfigDict(title="ClosedCurveSelection")

    plane_z: float = Field(
        title="Drive geometry plane Z",
        json_schema_extra=_ui_metadata(unit="mm", hidden=True, read_only=True),
    )
    vertices: list[Point2D] = Field(
        min_length=3,
        title="Closed curve vertices",
        description="Closed curves or closed surface edges captured from the selected mesh face.",
        json_schema_extra=_ui_metadata(hidden=True, read_only=True),
    )


class PocketControlGeometrySection(CamelBaseModel):
    model_config = ConfigDict(title="PocketControlGeometrySection")

    drive_geometry: list[ClosedCurveSelection] = Field(min_length=1, title="Drive geometries")


class PocketCutParametersSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketCutParametersSection")

    cut_direction: Literal["climb", "conventional"] = Field(
        default="climb",
        title="Climb/Conventional",
    )
    stepover: float = Field(
        default=25.0,
        gt=0,
        le=100,
        title="Stepover",
        json_schema_extra=_ui_metadata(unit="%"),
    )
    stock_to_leave: float = Field(
        default=0.0,
        ge=0,
        title="Stock to leave",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    pocket_strategy: Literal["inside", "outside"] = Field(
        default="inside",
        title="Pocket from inside/outside",
    )


class PocketMaterialSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketMaterialSection")

    feedrate: float = Field(
        default=500.0,
        gt=0,
        title="Feedrate",
        json_schema_extra=_ui_metadata(unit="mm/min"),
    )
    rpm: int = Field(default=12000, gt=0, title="RPM")


class PocketToolSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketToolSection")

    diameter: float = Field(
        default=12.0,
        gt=0,
        title="Diameter",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    flute_length: float = Field(
        default=30.0,
        gt=0,
        title="Flute length",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    tool_number: int = Field(default=1, ge=1, title="Tool #")
    manual_change: bool = Field(default=False, title="Manual change")


class PocketLevelsSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketLevelsSection")

    drive_geometry_reference: Literal["top", "bottom"] = Field(
        default="top",
        title="Drive geometry at top/bottom",
    )
    top_z: float = Field(
        default=0.0,
        title="Height of cut (top Z)",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    bottom_z: float = Field(
        default=-5.0,
        title="Bottom Z",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    max_cut_depth: float = Field(
        default=20.0,
        gt=0,
        title="Max cut depth",
        description="Maximum layer depth per pass.",
        json_schema_extra=_ui_metadata(unit="mm"),
    )

    @model_validator(mode="after")
    def validate_z_range(self) -> "PocketLevelsSection":
        if self.bottom_z > self.top_z:
            raise ValueError("Bottom Z must be less than or equal to top Z.")
        return self


class PocketClearanceSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketClearanceSection")

    clearance_plane_height: float = Field(
        default=25.4,
        title="Clearance plane height",
        description="Absolute clearance plane height used for retracts and transfers when selected.",
        json_schema_extra=_ui_metadata(unit="mm"),
    )
    transfer_height_mode: Literal["clearancePlane", "stockTopPlusOffset"] = Field(
        default="clearancePlane",
        title="Transfer height",
        description="Use the clearance plane directly, or compute transfer height as stock max Z plus an offset.",
    )
    transfer_height_offset: float = Field(
        default=5.0,
        ge=0,
        title="Transfer height offset",
        description="Only used when transfer height comes from stock max Z + X.",
        json_schema_extra=_ui_metadata(unit="mm"),
    )


class PocketAdvancedSection(CamelBaseModel):
    model_config = ConfigDict(title="PocketAdvancedSection")

    operation_sorting: Literal["shortestTravel"] = Field(
        default="shortestTravel",
        title="Operation sorting",
    )
    cut_transitions: Literal["clearance"] = Field(
        default="clearance",
        title="Cut transitions",
    )
    layer_order: Literal["perArea", "perLayer"] = Field(
        default="perLayer",
        title="Layer order",
    )
    chordal_tolerance: float = Field(
        default=0.01,
        gt=0,
        title="Chordal tolerance",
        json_schema_extra=_ui_metadata(unit="mm"),
    )


class Pocket2DOperationConfig(CamelBaseModel):
    model_config = ConfigDict(title="Pocket2DOperationConfig")

    id: str = Field(
        default_factory=lambda: str(uuid4()),
        title="Operation ID",
        json_schema_extra=_ui_metadata(hidden=True),
    )
    kind: Literal["pocket2d"] = Field(
        default="pocket2d",
        title="Operation kind",
        json_schema_extra=_ui_metadata(hidden=True),
    )
    display_name: str = Field(
        default="2D Pocket",
        title="Operation name",
        json_schema_extra=_ui_metadata(hidden=True),
    )
    control_geometry: PocketControlGeometrySection = Field(
        default_factory=PocketControlGeometrySection,
        title="Control geometry",
    )
    cut_parameters: PocketCutParametersSection = Field(
        default_factory=PocketCutParametersSection,
        title="Cut parameters",
    )
    material: PocketMaterialSection = Field(
        default_factory=PocketMaterialSection,
        title="Material",
    )
    tool: PocketToolSection = Field(default_factory=PocketToolSection, title="Tool")
    levels: PocketLevelsSection = Field(default_factory=PocketLevelsSection, title="Levels")
    clearance: PocketClearanceSection = Field(
        default_factory=PocketClearanceSection,
        title="Clearence",
    )
    advanced: PocketAdvancedSection = Field(default_factory=PocketAdvancedSection, title="Advanced")


MachiningOperation = Annotated[Pocket2DOperationConfig, Field(discriminator="kind")]


class GenerateToolpathRequest(CamelBaseModel):
    model_config = ConfigDict(title="GenerateToolpathRequest")

    setup: CamSetupConfig = Field(default_factory=CamSetupConfig, title="Setup")
    operation: MachiningOperation = Field(title="Operation")

    @model_validator(mode="after")
    def validate_transfer_height(self) -> "GenerateToolpathRequest":
        operation = self.operation
        top_z = operation.levels.top_z

        if operation.clearance.transfer_height_mode == "clearancePlane":
            transfer_height = operation.clearance.clearance_plane_height
        else:
            transfer_height = self.setup.stock.max_z + operation.clearance.transfer_height_offset

        if transfer_height <= top_z:
            raise ValueError("Transfer height must be above the operation top Z.")

        return self

    def to_closed_polylines(self) -> list[ClosedPolyline]:
        return [
            ClosedPolyline(vertices=geometry.vertices)
            for geometry in self.operation.control_geometry.drive_geometry
        ]


class FrontendCamSchemaBundle(CamelBaseModel):
    model_config = ConfigDict(title="FrontendCamSchemaBundle")

    generate_toolpath_request: dict = Field(serialization_alias="generateToolpathRequest")
    pocket2d_operation: dict = Field(serialization_alias="pocket2dOperation")


def build_frontend_cam_schema_bundle() -> FrontendCamSchemaBundle:
    return FrontendCamSchemaBundle(
        generate_toolpath_request=GenerateToolpathRequest.model_json_schema(mode="validation"),
        pocket2d_operation=Pocket2DOperationConfig.model_json_schema(mode="validation"),
    )
