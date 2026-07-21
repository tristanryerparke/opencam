from __future__ import annotations

from typing import Literal

from pydantic import ConfigDict, Field

from opencam.engine.parallel_finishing import build_parallel_finishing_records
from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.mesh import CachedMesh, Mesh
from opencam.schemas.operations.base import BaseCAMOperation, ui_metadata
from opencam.schemas.operations.pocketing import StepoverMode
from opencam.schemas.tools import BallTool, CylindricalTool


class ParallelFinishingDriveGeometry(CamelBaseModel):
    cut_areas: list[ClosedPolyline25D] = Field(min_length=1, title="Cut areas")


class ParallelFinishingCutSettings(CamelBaseModel):
    direction_degrees: float = Field(
        default=0.0,
        ge=0.0,
        lt=180.0,
        title="Direction",
        description="Lane travel direction in degrees from +X. Stepover advances 90 degrees CCW.",
        json_schema_extra=ui_metadata(unit="degrees"),
    )
    stepover: StepoverMode = Field(default_factory=StepoverMode, title="Stepover")
    stock_to_leave: float = Field(
        default=0.0,
        ge=0.0,
        title="Stock to leave",
        json_schema_extra=ui_metadata(unit="mm"),
    )


class ParallelFinishingOp(BaseCAMOperation):
    model_config = ConfigDict(title="ParallelFinishingOp")

    type: Literal["parallel_finishing"] = Field(default="parallel_finishing", frozen=True)
    display_name: str = Field(default="Parallel Finishing", title="Operation name")

    # Inline mesh data resolves directly; a cached reference needs a loader from
    # the host context (the server). Discriminated by `source`.
    part_mesh: Mesh | CachedMesh = Field(discriminator="source", title="Part mesh")
    drive_geometry: ParallelFinishingDriveGeometry = Field(title="Drive geometry")
    cut_parameters: ParallelFinishingCutSettings = Field(
        default_factory=ParallelFinishingCutSettings,
        title="Cut parameters",
    )

    def max_cut_z(self) -> float:
        if isinstance(self.part_mesh, Mesh):
            return max(vertex[2] for vertex in self.part_mesh.vertices)
        raise ValueError("Cannot determine max cut Z from a cached mesh before it is resolved.")

    def build_records(
        self,
        *,
        clearance_plane_height: float,
        mesh: Mesh,
    ) -> list[PositionRecord]:
        if not isinstance(self.tool, (CylindricalTool, BallTool)):
            raise NotImplementedError(
                f"Tool type {self.tool.type!r} is not supported for parallel finishing."
            )

        stepover_model = self.cut_parameters.stepover
        if stepover_model.mode == "absolute":
            stepover = stepover_model.value
        else:
            stepover = stepover_model.value / 100.0 * self.tool.diameter

        return build_parallel_finishing_records(
            mesh,
            cut_areas=[area.to_numpy() for area in self.drive_geometry.cut_areas],
            tool=self.tool,
            direction_degrees=self.cut_parameters.direction_degrees,
            stepover=stepover,
            stock_to_leave=self.cut_parameters.stock_to_leave,
            chord_tolerance=self.advanced.chordal_tolerance,
            feedrate=self.feeds_and_speeds.cut_feedrate,
            clearance_plane_height=clearance_plane_height,
        )
