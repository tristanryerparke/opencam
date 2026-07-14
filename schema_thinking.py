

import json
import subprocess
import uuid
from pathlib import Path

from pydantic import ConfigDict, Field, model_validator
from typing import Literal, Annotated

import numpy as np

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.geometry_2d import ClosedPolyline, Point2D



class Point3D(CamelBaseModel):
    x: float
    y: float
    z: float

    def as_numpy(self):
        return np.array([self.x, self.y, self.z])


class Vector3D(CamelBaseModel):
    x: float
    y: float
    z: float

    def as_numpy(self):
        return np.array([self.x, self.y, self.z])

    def amplitude(self):
        return np.linalg.norm(self.as_numpy())

class FeedsAndSpeeds(CamelBaseModel):
    spindle_rpm: int
    plunge_feedrate: float
    lead_in_feedrate: float
    cut_feedrate: float
    lead_out_feedrate: float
    departure_feedrate: float

class Material(CamelBaseModel):
    """DB-backed material record."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str


class ToolMaterialFeedsAndSpeeds(CamelBaseModel):
    """DB row for feeds/speeds for a specific tool cutting a specific material."""

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    tool_id: str
    material_id: str
    feeds_and_speeds: FeedsAndSpeeds

class ManualFeedsAndSpeedsSelection(CamelBaseModel):
    """Operation-specific manually entered feeds/speeds."""

    mode: Literal["manual"] = "manual"
    feeds_and_speeds: FeedsAndSpeeds

class ToolMaterialFeedsAndSpeedsSelection(CamelBaseModel):
    """Operation feeds/speeds selected from the backend tool/material database."""

    mode: Literal["tool_material"] = "tool_material"
    material_id: str
    tool_material_feeds_and_speeds_id: str

FeedsAndSpeedsSelection = Annotated[
    ManualFeedsAndSpeedsSelection | ToolMaterialFeedsAndSpeedsSelection,
    Field(discriminator="mode"),
]

class MeshData(CamelBaseModel):
    vertices: list[tuple[float, float, float]]
    faces: list[tuple[int, int, int]]

class StockMaxZPlusOffsetClearance(CamelBaseModel):
    clearence_height_type: Literal["stock_max_z_plus_offset"]
    offset: float


class PartMaxZPlusOffsetClearance(CamelBaseModel):
    clearence_height_type: Literal["part_max_z_plus_offset"]
    offset: float


class AbsoluteClearance(CamelBaseModel):
    clearence_height_type: Literal["absolute"]
    absolute_height: float


ClearenceSettings = Annotated[
    StockMaxZPlusOffsetClearance
    | PartMaxZPlusOffsetClearance
    | AbsoluteClearance,
    Field(discriminator="clearence_height_type", json_schema_extra={"ui_row_type":"radio_number_rows"}),
]

class ZContainment(CamelBaseModel):
    z_min: float | None = Field(json_schema_extra={"ui_row_type":"check-optional-group"})
    z_max: float | None = Field(json_schema_extra={"ui_row_type":"check-optional-group"})


class CAMLevels(CamelBaseModel):
    drive_geometry_position: Literal["at_top", "at_bottom"]
    depth_of_cut: float
    max_stepdown: float



class CAMAdvancedParameters(CamelBaseModel):
    operations_sorting: Literal["selection", "shortest_distance"]
    chordal_tolerance: float = 0.01

class BaseCAMOperation(CamelBaseModel):
    tool_id: str
    feeds_and_speeds: FeedsAndSpeedsSelection
    clearence: ClearenceSettings
    levels: CAMLevels
    advanced: CAMAdvancedParameters

class CAMSetup(CamelBaseModel):
    origin: Point3D = Point3D(x=0, y=0, z=0)
    z_axis: Vector3D = Vector3D(x=0, y=0, z=1)
    stock: MeshData | None
    operations: list[BaseCAMOperation]

class StepoverMode(CamelBaseModel):
    mode: Literal["percentage_of_tool_diameter", "absolute"]
    value: float

class PocketingDriveGeometry(CamelBaseModel):
    cut_areas: list[ClosedPolyline]

class PocketingCutSettings(CamelBaseModel):
    cut_direction: Literal["climb", "conventional"]
    stepover: StepoverMode = Field(title="Stepover")
    stock_to_leave: float = Field(title="Stock to Leave")

class PocketingOperation(BaseCAMOperation):
    drive_geometry: PocketingDriveGeometry
    cut_parameters: PocketingCutSettings


if __name__ == "__main__":
    root = Path(__file__).resolve().parent
    schema_path = root / "pocketing_operation.schema.json"
    ts_path = root / "pocketing_operation.ts"

    schema_path.write_text(
        json.dumps(PocketingOperation.model_json_schema(), indent=2) + "\n"
    )
    print(f"Wrote {schema_path}", flush=True)

    subprocess.run(
        [
            "uv",
            "run",
            "--with",
            "pydantic-to-typescript",
            "pydantic2ts",
            "--module",
            str(root / Path(__file__).name),
            "--output",
            str(ts_path),
            "--json2ts-cmd",
            str(root / "frontend/node_modules/.bin/json2ts"),
        ],
        check=True,
    )
