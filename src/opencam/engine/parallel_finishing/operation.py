from __future__ import annotations

from opencam.engine.parallel_finishing.toolpath import build_parallel_finishing_records
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.mesh import Mesh
from opencam.schemas.operations.parallel_finishing import ParallelFinishingOp
from opencam.schemas.tools import BallTool, CylindricalTool


def build_parallel_finishing_operation_records(
    operation: ParallelFinishingOp,
    *,
    mesh: Mesh,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if not isinstance(operation.tool, (CylindricalTool, BallTool)):
        raise NotImplementedError(
            f"Tool type {operation.tool.type!r} is not supported for parallel finishing."
        )

    stepover_model = operation.cut_parameters.stepover
    if stepover_model.mode == "absolute":
        stepover = stepover_model.value
    else:
        stepover = stepover_model.value / 100.0 * operation.tool.diameter

    return build_parallel_finishing_records(
        mesh,
        cut_areas=[area.to_numpy() for area in operation.drive_geometry.cut_areas],
        tool=operation.tool,
        direction_degrees=operation.cut_parameters.direction_degrees,
        stepover=stepover,
        stock_to_leave=operation.cut_parameters.stock_to_leave,
        chord_tolerance=operation.advanced.chordal_tolerance,
        feedrate=operation.feeds_and_speeds.cut_feedrate,
        clearance_plane_height=clearance_plane_height,
    )
