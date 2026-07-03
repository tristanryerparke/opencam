from __future__ import annotations

from opencam.schemas.cam import GenerateToolpathRequest, Pocket2DOperationConfig
from opencam.schemas.models import ToolpathOperation, Tool
from opencam.services.operations.pocketing.operation import ClosedPocketingEngine


def _transfer_height(request: GenerateToolpathRequest, operation: Pocket2DOperationConfig) -> float:
    if operation.clearance.transfer_height_mode == "stockTopPlusOffset":
        return request.setup.stock.max_z + operation.clearance.transfer_height_offset
    return operation.clearance.clearance_plane_height


def build_toolpath_operation_from_config(request: GenerateToolpathRequest) -> ToolpathOperation:
    operation = request.operation

    if operation.kind != "pocket2d":
        raise ValueError(f"Unsupported operation kind: {operation.kind}")

    engine = ClosedPocketingEngine(
        ring=request.to_closed_polyline(),
        tool=Tool(
            diameter=operation.tool.diameter,
            cutting_height=operation.tool.flute_length,
        ),
        feedrate=operation.material.feedrate,
        rpm=operation.material.rpm,
        clearance_plane_height=_transfer_height(request, operation),
        z_bounds=(operation.levels.top_z, operation.levels.bottom_z),
        z_step_height=operation.levels.max_cut_depth,
        stepover=operation.cut_parameters.stepover,
        stock_to_leave=operation.cut_parameters.stock_to_leave,
    )

    return ToolpathOperation(tool=engine.tool, paths=engine.process())
