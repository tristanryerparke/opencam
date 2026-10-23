"""Generate Duet 3D pocketing G-code from a Rhino curve.

Run from this repository:

    uv run python demos/rhino_pocketing.py

The script uses run-in-rhino only to select/reuse the current Rhino curve and
refresh the persistent display conduit. OpenCAM runs in the local modern Python
interpreter, not Rhino's Python 3.9 runtime. Output is ``demos/surfacing.nc``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from run_in_rhino.orchestration import run_rhino_python_til_done
from run_in_rhino.server import RunContext

FEEDRATE = 800.0
SPINDLE_SPEED = 18_000
TOOL_DIAMETER = 25.4
TOOL_NUMBER = 3
POCKET_DEPTH = 0
CLEARANCE_PLANE_HEIGHT = 50
STEPOVER_PERCENT = 40
TOOL_CUTTING_HEIGHT = 0

REPO_ROOT = Path(__file__).resolve().parents[1]
RHINO_DIR = Path(__file__).with_name("rhino_pocketing")
GCODE_PATH = Path(__file__).with_name("surfacing.nc")


def run_rhino_script(script_path: Path, environment: dict | None = None) -> list[str]:
    reason, data = run_rhino_python_til_done(
        script_path=script_path,
        context=RunContext(env=environment or {}),
    )
    if reason != "done":
        raise RuntimeError(f"Rhino script {script_path.name} ended with {reason!r}.")
    return data


def select_curve() -> dict:
    data = run_rhino_script(RHINO_DIR / "select_curve.py", {"prompt": "Select a closed pocket boundary"})
    if not data:
        raise RuntimeError("No Rhino curve was selected.")
    return json.loads(data[0])


def build_operation(points: list[list[float]]):
    from opencam_contracts.cam import CAMSetup
    from opencam_contracts.geometry_2_5d import ClosedPolyline25D
    from opencam_contracts.geometry_2d import Point2D
    from opencam_contracts.operations.base import CAMLevels, FeedsAndSpeeds
    from opencam_contracts.operations.pocketing import Pocketing2dOp, PocketingCutSettings, StepoverMode
    from opencam_contracts.tools import CylindricalTool
    from opencam.services.cam_engine import cam_engine

    z_values = [point[2] for point in points]
    z = sum(z_values) / len(z_values)
    if max(abs(value - z) for value in z_values) > 0.01:
        raise ValueError("The selected curve must be planar parallel to World XY.")

    tool = CylindricalTool(
        name="1 inch flat end mill",
        tool_number=TOOL_NUMBER,
        diameter=TOOL_DIAMETER,
        cutting_height=TOOL_CUTTING_HEIGHT,
        shoulder_height=TOOL_CUTTING_HEIGHT,
    )
    operation = Pocketing2dOp(
        tool=tool,
        clearance={"clearance_height_type": "absolute", "absolute_height": z + CLEARANCE_PLANE_HEIGHT},
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=FEEDRATE, spindle_rpm=SPINDLE_SPEED),
        levels=CAMLevels(depth_of_cut=POCKET_DEPTH),
        cut_parameters=PocketingCutSettings(
            stepover=StepoverMode(mode="percentage_of_tool_diameter", value=STEPOVER_PERCENT)
        ),
        drive_geometry=[ClosedPolyline25D(z=z, vertices=[Point2D(x=x, y=y) for x, y, _ in points])],
    )
    return cam_engine(CAMSetup(), operation)


def write_gcode(operation) -> None:
    from opencam.post_processing.duet3d.models import build_default_duet3d_machine
    from opencam.post_processing.duet3d.post_processor import Duet3DPostProcessor
    from opencam.services.tool_library import ToolLibrary
    from tinydb import TinyDB
    from tinydb.storages import MemoryStorage

    library = ToolLibrary(db=TinyDB(storage=MemoryStorage))
    try:
        library.add_tool(operation.tool)
        processor = Duet3DPostProcessor(build_default_duet3d_machine(), library)
        GCODE_PATH.write_text(processor.post_process([operation], program_name="Rhino pocketing"), encoding="utf-8")
    finally:
        library.close()


def display_payload(operation) -> dict:
    records = operation.records
    segments = []
    points = []
    role = None
    for index in range(1, len(records)):
        start = records[index - 1]
        end = records[index]
        next_role = "rapid" if end.feed_type == "rapid" else getattr(end, "motion_role", "cutting")
        if next_role != role:
            if points:
                segments.append({"role": role, "points": points})
            role = next_role
            points = [[start.x, start.y, start.z], [end.x, end.y, end.z]]
        else:
            points.append([end.x, end.y, end.z])
    if points:
        segments.append({"role": role, "points": points})
    return {
        "segments": segments,
        "start": [records[0].x, records[0].y, records[0].z],
        "end": [records[-1].x, records[-1].y, records[-1].z],
    }


def main() -> None:
    selected = select_curve()
    operation = build_operation(selected["points"])
    write_gcode(operation)
    display = run_rhino_script(RHINO_DIR / "display_toolpath.py", {"toolpath": display_payload(operation)})
    if len(display) != 1 or not json.loads(display[0])["conduit_enabled"]:
        raise RuntimeError("Rhino did not enable the toolpath conduit.")
    print(f"Wrote {GCODE_PATH} and displayed {len(operation.records)} toolpath records.")


if __name__ == "__main__":
    main()
