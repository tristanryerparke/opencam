from __future__ import annotations

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import (
    build_cut_record_sequence,
    duplicate_layers_at_heights,
    stitch_geometry_records,
)
from opencam.engine.pocketing.layer import build_pocket_layers
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.tools import BallTool, CylindricalTool


def pocketing_max_cut_z(operation: Pocketing2dOp) -> float:
    return operation.levels.max_cut_z(area.z for area in operation.drive_geometry.cut_areas)


def build_pocketing_records(
    operation: Pocketing2dOp,
    *,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if not isinstance(operation.tool, (CylindricalTool, BallTool)):
        raise NotImplementedError(
            f"Tool type {operation.tool.type!r} is not supported for operation generation."
        )

    stepover = operation.cut_parameters.stepover
    stepover_percent = stepover.value
    if stepover.mode == "absolute":
        stepover_percent = stepover.value / operation.tool.diameter * 100

    record_groups: list[list[PositionRecord]] = []
    for geometry in operation.drive_geometry.cut_areas:
        layers = build_pocket_layers(
            geometry.to_numpy(),
            tool_diameter=operation.tool.diameter,
            stepover_percent=stepover_percent,
            stock_to_leave=operation.cut_parameters.stock_to_leave,
            chord_tolerance=operation.advanced.chordal_tolerance,
        )
        if not layers:
            raise ValueError("Pocketing geometry is too small for the selected tool diameter and stock to leave.")

        cut_layers = duplicate_layers_at_heights(
            layers,
            compute_layer_heights(
                operation.levels.z_bounds(geometry.z),
                operation.levels.max_stepdown,
            ),
            feedrate=operation.feeds_and_speeds.cut_feedrate,
        )
        record_groups.append(
            build_cut_record_sequence(
                cut_layers,
                clearance_plane_height=clearance_plane_height,
            )
        )

    return stitch_geometry_records(record_groups)
