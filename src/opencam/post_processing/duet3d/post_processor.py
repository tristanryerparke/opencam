from __future__ import annotations

import math
from collections.abc import Sequence

from opencam.post_processing.duet3d.models import Duet3DMachineDefinition
from opencam.post_processing.gcode import GcodeCommand, GcodeMove, emit_gcode
from opencam.schemas.cl_data import FeedRatePositionRecord3D, OperationRecord3D, PositionRecord3D
from opencam.schemas.tools import Tool
from opencam.services.tool_library import ToolLibrary


class Duet3DPostProcessor:
    """Translate three-axis OpenCAM cutter-location records to RepRapFirmware G-code."""

    def __init__(
        self,
        machine: Duet3DMachineDefinition,
        tool_library: ToolLibrary,
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
        self._validate_machine()

        objects: list[GcodeMove | GcodeCommand] = [
            GcodeCommand(self._comment(program_name)),
            GcodeCommand(self._comment(f"Machine: {self.machine.name}")),
            GcodeCommand(self._generic("G21", "millimeters")),
            GcodeCommand(self._generic("G90", "absolute coordinates")),
            GcodeCommand(self._generic("G17", "XY plane")),
            GcodeCommand(self._generic("G54", "work coordinate system")),
        ]

        used_tool_numbers: dict[int, str] = {}
        for index, operation in enumerate(operations, start=1):
            tool = self._resolve_tool(operation.tool)
            self._validate_operation(operation, tool, used_tool_numbers)
            objects.extend(self._operation_objects(operation, tool, index))

        objects.append(GcodeCommand(self._comment("End OpenCAM program")))
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
            ]
        )

        for record in operation.records:
            if isinstance(record, FeedRatePositionRecord3D):
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

    def _validate_operation(
        self,
        operation: OperationRecord3D,
        tool: Tool,
        used_tool_numbers: dict[int, str],
    ) -> None:
        if len(operation.tool_axis) != 3 or any(
            not math.isclose(actual, expected, abs_tol=1e-9)
            for actual, expected in zip(operation.tool_axis, (0.0, 0.0, 1.0), strict=True)
        ):
            raise ValueError("Duet 3D baseline post processor supports only a +Z three-axis tool axis.")
        if not operation.records:
            raise ValueError("Operations must contain at least one cutter-location record.")
        if not 0 <= tool.tool_number <= 49:
            raise ValueError("RepRapFirmware tool numbers must be between 0 and 49.")

        existing_tool_id = used_tool_numbers.get(tool.tool_number)
        if existing_tool_id is not None and existing_tool_id != tool.id:
            raise ValueError(f"Tool number {tool.tool_number} is assigned to multiple tools in this program.")
        used_tool_numbers[tool.tool_number] = tool.id

        spindle = self.machine.spindle
        if not spindle.minimum_rpm <= operation.spindle_rpm <= spindle.maximum_rpm:
            raise ValueError(
                f"Spindle speed {operation.spindle_rpm} RPM is outside machine range "
                f"{spindle.minimum_rpm}-{spindle.maximum_rpm} RPM."
            )

        z_axis = self._axes["Z"]
        if not z_axis.minimum_position <= operation.clearance_plane_height <= z_axis.maximum_position:
            raise ValueError(
                f"Clearance plane {operation.clearance_plane_height} is outside Z-axis travel "
                f"{z_axis.minimum_position} to {z_axis.maximum_position}."
            )

        previous_record: PositionRecord3D | None = None
        for record in operation.records:
            self._validate_position(record, previous_record)
            previous_record = record

    def _validate_position(
        self,
        record: PositionRecord3D,
        previous_record: PositionRecord3D | None,
    ) -> None:
        coordinates = {"X": record.x, "Y": record.y, "Z": record.z}
        for letter, value in coordinates.items():
            if not math.isfinite(value):
                raise ValueError(f"{letter} coordinate must be finite.")
            axis = self._axes[letter]
            if not axis.minimum_position <= value <= axis.maximum_position:
                raise ValueError(
                    f"{letter} coordinate {value} is outside machine travel "
                    f"{axis.minimum_position} to {axis.maximum_position}."
                )

        if not isinstance(record, FeedRatePositionRecord3D):
            return
        if not math.isfinite(record.feedrate) or record.feedrate <= 0:
            raise ValueError("Feed rate must be finite and greater than zero.")
        if previous_record is None:
            return

        deltas = {
            "X": record.x - previous_record.x,
            "Y": record.y - previous_record.y,
            "Z": record.z - previous_record.z,
        }
        distance = math.sqrt(sum(delta * delta for delta in deltas.values()))
        if math.isclose(distance, 0.0):
            return
        for letter, delta in deltas.items():
            maximum_feedrate = self._axes[letter].maximum_feedrate
            component_feedrate = record.feedrate * abs(delta) / distance
            if maximum_feedrate is not None and component_feedrate > maximum_feedrate:
                raise ValueError(
                    f"{letter}-axis feed component {component_feedrate} exceeds machine maximum "
                    f"{maximum_feedrate}."
                )

    def _generic(self, code: str, description: str) -> str:
        if self.verbose_comments:
            return f"{code} ; {description}"
        return code

    @staticmethod
    def _comment(value: str) -> str:
        sanitized = " ".join(value.replace("\x00", "").splitlines()).strip()
        return f"; {sanitized}"
