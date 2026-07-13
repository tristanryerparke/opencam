from __future__ import annotations

from opencam.schemas.cam import GenerateToolpathRequest
from opencam.schemas.cl_data import OperationRecord3D, PositionRecord, PositionRecord3D, RapidPositionRecord3D
from opencam.schemas.models import ClosedPolyline, Tool
from opencam.schemas.operations.base import (
    ManualFeedsAndSpeedsSelection,
    ToolMaterialFeedsAndSpeedsSelection,
)
from opencam.schemas.operations.pocketing import ClosedCurveSelection, Pocket2DOperationConfig
from opencam.services.operations.pocketing.operation import ClosedPocketingEngine
from opencam.services.tool_library import ToolLibrary


def _tool_and_feeds(
    operation: Pocket2DOperationConfig,
    tool_library: ToolLibrary,
) -> tuple[Tool, float, int, str]:
    library_tool = tool_library.get_tool(operation.tool_id)
    if library_tool is None:
        raise ValueError(f"Tool {operation.tool_id!r} does not exist.")

    selection = operation.feeds_and_speeds
    if isinstance(selection, ManualFeedsAndSpeedsSelection):
        feeds_and_speeds = selection.feeds_and_speeds
    elif isinstance(selection, ToolMaterialFeedsAndSpeedsSelection):
        record = tool_library.get_tool_material_feeds_and_speeds(
            selection.tool_material_feeds_and_speeds_id,
        )
        if record is None:
            raise ValueError(
                "Selected tool/material feeds and speeds record does not exist."
            )
        if record.tool_id != operation.tool_id or record.material_id != selection.material_id:
            raise ValueError("Selected feeds and speeds record does not match the tool and material.")
        feeds_and_speeds = record.feeds_and_speeds
    else:  # pragma: no cover - exhaustive discriminated union
        raise ValueError("Unsupported feeds and speeds selection.")

    return (
        Tool(diameter=library_tool.diameter, cutting_height=library_tool.flute_length),
        feeds_and_speeds.cut_feedrate,
        feeds_and_speeds.spindle_rpm,
        library_tool.id,
    )


def _z_bounds(operation: Pocket2DOperationConfig, geometry: ClosedCurveSelection) -> tuple[float, float]:
    if operation.levels.drive_geometry_position == "at_top":
        return geometry.plane_z, geometry.plane_z - operation.levels.depth_of_cut
    return geometry.plane_z + operation.levels.depth_of_cut, geometry.plane_z


def _stepover_percentage(operation: Pocket2DOperationConfig, tool: Tool) -> float:
    stepover = operation.cut_parameters.stepover
    if stepover.mode == "percentage_of_tool_diameter":
        return stepover.value
    return stepover.value / tool.diameter * 100


def _build_pocket_engine(
    request: GenerateToolpathRequest,
    operation: Pocket2DOperationConfig,
    geometry: ClosedCurveSelection,
    tool_library: ToolLibrary,
) -> ClosedPocketingEngine:
    tool, feedrate, rpm, tool_id = _tool_and_feeds(operation, tool_library)
    return ClosedPocketingEngine(
        ring=ClosedPolyline(vertices=geometry.vertices),
        tool=tool,
        tool_id=tool_id,
        feedrate=feedrate,
        rpm=rpm,
        clearance_plane_height=request.clearance_height(),
        z_bounds=_z_bounds(operation, geometry),
        z_step_height=operation.levels.max_stepdown,
        stepover=_stepover_percentage(operation, tool),
        stock_to_leave=operation.cut_parameters.stock_to_leave,
    )


def _xy_travel_record(
    start: PositionRecord3D,
    end: PositionRecord3D,
) -> RapidPositionRecord3D | None:
    if start.x == end.x and start.y == end.y and start.z == end.z:
        return None
    return RapidPositionRecord3D(
        x=end.x,
        y=end.y,
        z=start.z,
        comment="travel to next pocket",
    )


def build_toolpath_operation_from_config(
    request: GenerateToolpathRequest,
    tool_library: ToolLibrary,
) -> OperationRecord3D:
    operation = request.operation

    if operation.kind != "pocket2d":
        raise ValueError(f"Unsupported operation kind: {operation.kind}")

    _, _, _, tool_id = _tool_and_feeds(operation, tool_library)
    records: list[PositionRecord] = []

    for geometry in operation.drive_geometry.cut_areas:
        pocket_records = _build_pocket_engine(request, operation, geometry, tool_library).process()
        if records and pocket_records:
            travel = _xy_travel_record(records[-1], pocket_records[0])
            if travel is not None:
                records.append(travel)
            if records and records[-1].x == pocket_records[0].x and records[-1].y == pocket_records[0].y and records[-1].z == pocket_records[0].z:
                pocket_records = pocket_records[1:]
        records.extend(pocket_records)

    return OperationRecord3D(
        tool_id=tool_id,
        clearance_plane_height=request.clearance_height(),
        records=records,
    )
