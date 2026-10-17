from __future__ import annotations

from typing import Literal

DEFAULT_PRECISION = 3


def fg(value: float, precision: int = DEFAULT_PRECISION) -> str:
    """Format a number for G-code output; also used for culling comparisons."""
    rounded = round(value, precision)
    if rounded == 0:
        rounded = 0.0
    formatted = f"{rounded:.{precision}f}"
    if "." in formatted:
        formatted = formatted.rstrip("0").rstrip(".")
    return formatted or "0"


class GcodeCommand:
    """A raw G-code line such as a setting, spindle, or tool command."""

    def __init__(self, command: str):
        self.command = command

    def out(self) -> str:
        return self.command


class GcodeMove:
    """A G0/G1/G2/G3 move with optional axis words and a modal feed rate."""

    def __init__(
        self,
        type: Literal["G0", "G1", "G2", "G3"],
        x: float | None = None,
        y: float | None = None,
        z: float | None = None,
        i: float | None = None,
        j: float | None = None,
        feedrate: float | None = None,
        comment: str | None = None,
    ):
        self.type = type
        self.x = x
        self.y = y
        self.z = z
        self.i = i
        self.j = j
        self.feedrate = feedrate
        self.comment = comment

    def out(self, skip_prefix: bool = False) -> str:
        words = [self.type] if not skip_prefix else []
        if self.x is not None:
            words.append(f"X{fg(self.x)}")
        if self.y is not None:
            words.append(f"Y{fg(self.y)}")
        if self.z is not None:
            words.append(f"Z{fg(self.z)}")
        if self.i is not None:
            words.append(f"I{fg(self.i)}")
        if self.j is not None:
            words.append(f"J{fg(self.j)}")
        if self.feedrate is not None:
            words.append(f"F{fg(self.feedrate)}")
        line = " ".join(words)
        if self.comment:
            line += f" ; {self.comment}"
        return line


def emit_gcode(
    gcode_objects: list[GcodeMove | GcodeCommand],
    *,
    precision: int = DEFAULT_PRECISION,
    enable_axis_culling: bool = True,
) -> list[str]:
    """Turn G-code objects into lines.

    Removes axis words whose value is unchanged from the previous move
    (if enable_axis_culling is True), removes repeated motion prefixes only
    within uninterrupted sequences of the same move type, and skips fully
    culled no-op moves.
    Any non-move command resets the culling state.
    """
    gcode_strings: list[str] = []

    running: dict[str, str | None] = {"x": None, "y": None, "z": None, "f": None}
    pending_feedrate: str | None = None
    previous_move_type: str | None = None
    for obj in gcode_objects:
        if isinstance(obj, GcodeMove):
            formatted = {
                "x": fg(obj.x, precision) if obj.x is not None else None,
                "y": fg(obj.y, precision) if obj.y is not None else None,
                "z": fg(obj.z, precision) if obj.z is not None else None,
                "f": fg(obj.feedrate, precision) if obj.feedrate is not None else None,
            }

            if enable_axis_culling:
                if running["x"] == formatted["x"]:
                    obj.x = None
                if running["y"] == formatted["y"]:
                    obj.y = None
                if running["z"] == formatted["z"]:
                    obj.z = None
                if running["f"] == formatted["f"]:
                    obj.feedrate = None

            # A feedrate-only CL record establishes a pending modal feed. Fold
            # it into the following physical move rather than writing `F800`
            # as its own line.
            if (
                obj.feedrate is not None
                and obj.x is None
                and obj.y is None
                and obj.z is None
                and obj.i is None
                and obj.j is None
            ):
                pending_feedrate = formatted["f"]
                previous_move_type = None
                continue

            if pending_feedrate is not None:
                obj.feedrate = float(pending_feedrate)
                formatted["f"] = pending_feedrate
                pending_feedrate = None

            # Reassert motion when a move itself changes the modal feed.
            skip_prefix = previous_move_type == obj.type and running["f"] == formatted["f"]
            line = obj.out(skip_prefix=skip_prefix)
            if line:
                gcode_strings.append(line)

            previous_move_type = obj.type
            for axis, value in formatted.items():
                running[axis] = value
        else:
            gcode_strings.append(obj.out())
            previous_move_type = None
            running = {"x": None, "y": None, "z": None, "f": None}
            pending_feedrate = None

    return gcode_strings
