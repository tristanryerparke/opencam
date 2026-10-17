from __future__ import annotations

from opencam.engine.levels.heights import compute_layer_heights
from opencam.engine.levels.layers import (
    build_cut_record_sequence,
    duplicate_layers_at_heights,
    stitch_geometry_records,
)
from opencam.engine.pocketing.adaptive import build_adaptive_pocket_layers
from opencam.engine.pocketing.layer import build_pocket_layers
from opencam.engine.pocketing.linking import (
    build_keep_down_links,
    build_linked_cut_layers,
    build_tangent_lead_in_layers,
)
from opencam.schemas.cl_data import PositionRecord
from opencam.schemas.operations.pocketing import Pocketing2dOp
from opencam.schemas.tools import BallTool, CylindricalTool


def pocketing_max_cut_z(operation: Pocketing2dOp) -> float:
    return operation.levels.max_cut_z(area.z for area in operation.drive_geometry)


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

    clearing_layer_builder = (
        build_adaptive_pocket_layers
        if operation.cut_parameters.clearing_strategy == "adaptive"
        else build_pocket_layers
    )

    record_groups: list[list[PositionRecord]] = []
    for geometry in operation.drive_geometry:
        polyline = geometry.to_numpy()
        layers = clearing_layer_builder(
            polyline,
            tool_diameter=operation.tool.diameter,
            stepover_percent=stepover_percent,
            stock_to_leave=operation.cut_parameters.stock_to_leave,
            chord_tolerance=operation.advanced.chordal_tolerance,
            cut_direction=operation.cut_parameters.cut_direction,
        )
        if not layers:
            raise ValueError(
                "Pocketing geometry is too small for the selected tool diameter and stock to leave."
            )

        heights = compute_layer_heights(
            operation.levels.z_bounds(geometry.z),
            operation.levels.max_stepdown,
        )
        if operation.cut_parameters.keep_tool_down:
            links = build_keep_down_links(
                layers,
                polyline,
                tool_diameter=operation.tool.diameter,
                stock_to_leave=operation.cut_parameters.stock_to_leave,
                chord_tolerance=operation.advanced.chordal_tolerance,
            )
            cut_layers = build_linked_cut_layers(
                layers,
                links,
                heights,
                feedrate=operation.feeds_and_speeds.cut_feedrate,
            )
        elif getattr(layers, "internal_links", None):
            cut_layers = build_linked_cut_layers(
                layers,
                [None] * (len(layers) - 1),
                heights,
                feedrate=operation.feeds_and_speeds.cut_feedrate,
            )
        else:
            cut_layers = duplicate_layers_at_heights(
                layers,
                heights,
                feedrate=operation.feeds_and_speeds.cut_feedrate,
            )
        cut_layers = build_tangent_lead_in_layers(
            cut_layers,
            polyline=polyline,
            tool_diameter=operation.tool.diameter,
            stock_to_leave=operation.cut_parameters.stock_to_leave,
            chord_tolerance=operation.advanced.chordal_tolerance,
            feedrate=operation.feeds_and_speeds.lead_in_feedrate,
            skip_first_layer=True,
        )
        record_groups.append(
            build_cut_record_sequence(
                cut_layers,
                clearance_plane_height=clearance_plane_height,
                plunge_feedrate=operation.feeds_and_speeds.plunge_feedrate,
            )
        )

    return stitch_geometry_records(record_groups)
