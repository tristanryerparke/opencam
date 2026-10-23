from __future__ import annotations

import math
from collections.abc import Sequence

from opencam.post_processing.duet3d.models import Duet3DMachineDefinition
from opencam.post_processing.gcode import GcodeCommand, GcodeMove, emit_gcode
from opencam_contracts.cl_data import (
    ArcPositionRecord3D,
    FeedRatePositionRecord3D,
    OperationRecord3D,
)
from opencam_contracts.tools import Tool
from opencam.services.tool_library import ToolLibrary


class Duet3DPostProcessor:
    """Translate three-axis OpenCAM cutter-location records to RepRapFirmware G-code."""

    def __init__(
        self,
        machine: Duet3DMachineDefinition,
        tool_library: ToolLibrary | None,
        *,
        coordinate_precision: int = 3,
        verbose_comments: bool = False,
    ):
        self.machine = machine
        self.tool_library = tool_library
        if not 0 <= coordinate_precision <= 6:
            raise ValueError("Coordinate precision must be between 0 and 6 decimal places.")
        self.coordinate_precision = coordinate_precision
        self.verbose_comments = verbose_comments
        self._axes = {axis.letter: axis for axis in self.machine.axes}

    def post_process(
        self,
        operations: Sequence[OperationRecord3D],
        *,
        program_name: str = "OpenCAM program",
    ) -> str:
        if not operations:
            raise ValueError("At least one operation is required for post processing.")
        objects: list[GcodeMove | GcodeCommand] = [
            GcodeCommand(self._comment(program_name)),
            GcodeCommand(self._comment(f"Machine: {self.machine.name}")),
            GcodeCommand(self._generic("G21", "millimeters")),
            GcodeCommand(self._generic("G90", "absolute coordinates")),
            GcodeCommand(self._generic("G17", "XY plane")),
            GcodeCommand(self._generic("G54", "work coordinate system")),
            GcodeCommand('M98 P"0:/macros/dust_on.g"'),
        ]

        used_tool_numbers: dict[int, str] = {}
        for index, operation in enumerate(operations, start=1):
            tool = self._resolve_tool(operation.tool)
            self._validate_operation_tool(operation, tool, used_tool_numbers)
            objects.extend(self._operation_objects(operation, tool, index))

        objects.extend(
            [
                GcodeCommand('M98 P"0:/macros/dust_off.g"'),
                GcodeCommand(self._comment("End OpenCAM program")),
            ]
        )
        lines = emit_gcode(objects, precision=self.coordinate_precision)
        return "\n".join(lines) + "\n"

    def _validate_machine(self) -> None:
        axis_letters = [axis.letter for axis in self.machine.axes]
        if len(axis_letters) != 3 or set(axis_letters) != {"X", "Y", "Z"}:
            raise ValueError("Three-axis machines require exactly one X, Y, and Z axis.")

        for axis in self.machine.axes:
            if not math.isfinite(axis.minimum_position) or not math.isfinite(axis.maximum_position):
                raise ValueError(f"{axis.letter}-axis travel limits must be finite.")
            if axis.maximum_position <= axis.minimum_position:
                raise ValueError(
                    f"{axis.letter}-axis maximum position must be greater than its minimum position."
                )
            if axis.maximum_feedrate is not None and (
                not math.isfinite(axis.maximum_feedrate) or axis.maximum_feedrate <= 0
            ):
                raise ValueError(f"{axis.letter}-axis maximum feed rate must be finite and positive.")

        spindle = self.machine.spindle
        if spindle.minimum_rpm <= 0 or spindle.maximum_rpm <= 0:
            raise ValueError("Spindle speed limits must be positive.")
        if spindle.maximum_rpm < spindle.minimum_rpm:
            raise ValueError("Spindle maximum RPM must be greater than or equal to its minimum RPM.")

    def _resolve_tool(self, requested_tool: Tool) -> Tool:
        if self.tool_library is None:
            return requested_tool
        library_tool = self.tool_library.get_tool(requested_tool.id)
        if library_tool is None:
            raise ValueError(f"Tool {requested_tool.id!r} is not present in the tool library.")
        if library_tool != requested_tool:
            raise ValueError(
                f"Tool {requested_tool.id!r} differs from the tool library record; regenerate the toolpath."
            )
        return library_tool

    def _operation_objects(
        self,
        operation: OperationRecord3D,
        tool: Tool,
        index: int,
    ) -> list[GcodeMove | GcodeCommand]:
        objects: list[GcodeMove | GcodeCommand] = [
            GcodeCommand(""),
            GcodeCommand(self._comment(f"Operation {index}")),
            GcodeCommand(self._comment(f"Tool {tool.tool_number}: {tool.name}")),
        ]
        objects.extend(GcodeCommand(self._comment(c)) for c in operation.pre_comments)
        retract_comment = "retract to clearance plane" if self.verbose_comments else None
        objects.extend(
            [
                GcodeCommand(f"T{tool.tool_number}"),
                GcodeMove("G0", z=operation.clearance_plane_height, comment=retract_comment),
                GcodeCommand(f"M3 S{operation.spindle_rpm}"),
                GcodeCommand("G4 S3"),
            ]
        )

        for record in operation.records:
            if isinstance(record, ArcPositionRecord3D):
                objects.append(
                    GcodeMove(
                        "G2" if record.clockwise else "G3",
                        x=record.x,
                        y=record.y,
                        z=record.z,
                        i=record.center_offset_x,
                        j=record.center_offset_y,
                        feedrate=record.feedrate,
                        comment=record.comment,
                    )
                )
            elif isinstance(record, FeedRatePositionRecord3D):
                objects.append(
                    GcodeMove(
                        "G1",
                        x=record.x,
                        y=record.y,
                        z=record.z,
                        feedrate=record.feedrate,
                        comment=record.comment,
                    )
                )
            else:
                objects.append(GcodeMove("G0", x=record.x, y=record.y, z=record.z, comment=record.comment))

        objects.extend(GcodeCommand(self._comment(c)) for c in operation.post_comments)
        objects.append(GcodeCommand("M5"))
        return objects

    def _validate_operation_tool(
        self,
        operation: OperationRecord3D,
        tool: Tool,
        used_tool_numbers: dict[int, str],
    ) -> None:
        if not operation.records:
            raise ValueError("Operations must contain at least one cutter-location record.")
        if not 0 <= tool.tool_number <= 49:
            raise ValueError("RepRapFirmware tool numbers must be between 0 and 49.")

        existing_tool_id = used_tool_numbers.get(tool.tool_number)
        if existing_tool_id is not None and existing_tool_id != tool.id:
            raise ValueError(f"Tool number {tool.tool_number} is assigned to multiple tools in this program.")
        used_tool_numbers[tool.tool_number] = tool.id


    def _generic(self, code: str, description: str) -> str:
        if self.verbose_comments:
            return f"{code} ; {description}"
        return code

    @staticmethod
    def _comment(value: str) -> str:
        sanitized = " ".join(value.replace("\x00", "").splitlines()).strip()
        return f"; {sanitized}"
