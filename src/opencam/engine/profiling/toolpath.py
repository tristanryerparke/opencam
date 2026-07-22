from __future__ import annotations

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import (
    build_cut_record_sequence,
    duplicate_layers_at_heights,
    stitch_geometry_records,
)
from opencam.engine.profiling.layer import build_profile_layers
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.operations.profiling import Profiling2dOp
from opencam.schemas.tools import BallTool, CylindricalTool


def profiling_max_cut_z(operation: Profiling2dOp) -> float:
    return operation.levels.max_cut_z(profile.z for profile in operation.drive_geometry)


def build_profiling_records(
    operation: Profiling2dOp,
    *,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    if not isinstance(operation.tool, (CylindricalTool, BallTool)):
        raise NotImplementedError(
            f"Tool type {operation.tool.type!r} is not supported for operation generation."
        )

    record_groups: list[list[PositionRecord]] = []
    for geometry in operation.drive_geometry:
        layers = build_profile_layers(
            geometry,
            tool_diameter=operation.tool.diameter,
            stock_to_leave=operation.cut_parameters.stock_to_leave,
            side=operation.cut_parameters.side,
            chord_tolerance=operation.advanced.chordal_tolerance,
        )
        if not layers:
            raise ValueError("Profiling geometry is too small for the selected tool diameter and stock to leave.")

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
