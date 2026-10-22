from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from opencam.schemas.cam import CAMSetup
from opencam.schemas.cl_data import OperationRecord3D
from opencam.schemas.geometry_2_5d import ClosedPolyline25D
from opencam.schemas.geometry_2d import Point2D
from opencam.schemas.operations.base import AbsoluteClearance, CAMLevels, FeedsAndSpeeds
from opencam.schemas.operations.facing import Facing2dOp, FacingCutSettings
from opencam.schemas.operations.pocketing import StepoverMode
from opencam.schemas.tools import CylindricalTool
from opencam.services.cam_engine import cam_engine
from rhino_renderer.file_client import FileClient
from rhino_renderer.file_client import current_document_path
from rhino_renderer.file_client import reset_rhino_environment
from rhino_renderer.redis_utils import REDIS
from rhino_renderer.rhino_pipe import run_script

PROMPT = "Select one closed rectangular curve at the bottom of the face"
TOOLPATH_PARENT_LAYER_NAME = "TOOLPATH"
TOOLPATH_LAYER_NAME = "FACING"
PROMPT_TIMEOUT_SECONDS = 45.0
PAYLOAD_KEY = "opencam:rhino_toolpath_payload"
RHINO_ADD_TOOLPATH_SCRIPT = SCRIPT_DIR / "rhino_add_toolpaths.py"

TOOL_DIAMETER = 20
CUTTING_HEIGHT = 30
CUT_DEPTH = 6.0
Z_STEP_HEIGHT = 20
STEPOVER = 45
FEEDRATE = 500.0
RPM = 12000
CLEARANCE_PLANE_HEIGHT = 50
CUT_DIRECTION = "mixed"
DIRECTION_DEGREES = 0.0


def point_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def rectangle_corners_from_geometry(geometry) -> tuple[tuple[float, float, float], ...]:
    polyline = None
    if hasattr(geometry, "TryGetPolyline"):
        polyline = geometry.TryGetPolyline()
    if polyline is None and hasattr(geometry, "ToPolyline"):
        polyline = geometry.ToPolyline()
    if polyline is None:
        raise ValueError("Selected curve could not be converted to a polyline.")

    points = [
        (float(polyline[i].X), float(polyline[i].Y), float(polyline[i].Z))
        for i in range(len(polyline))
    ]
    if len(points) < 5:
        raise ValueError("Selected curve must contain at least 5 polyline points.")
    if point_distance(points[0], points[-1]) > 1e-6:
        raise ValueError("Selected curve must be closed.")
    corners = points[:-1]
    if len(corners) != 4:
        raise ValueError("Selected curve must be a rectangle with four corners.")

    z_level = corners[0][2]
    for _, _, z in corners[1:]:
        if abs(z - z_level) > 1e-6:
            raise ValueError("Selected curve must be planar in Z.")
    return tuple(corners)


def build_operation(corners: tuple[tuple[float, float, float], ...]):
    if CUT_DEPTH <= 0:
        raise ValueError("CUT_DEPTH must be greater than 0.")

    bottom_z = corners[0][2]
    top_z = bottom_z + CUT_DEPTH
    if CLEARANCE_PLANE_HEIGHT <= top_z:
        raise ValueError("CLEARANCE_PLANE_HEIGHT must be above the top of the cut.")

    tool = CylindricalTool(
        name="Rhino facing tool",
        tool_number=1,
        diameter=TOOL_DIAMETER,
        cutting_height=CUTTING_HEIGHT,
        shoulder_height=CUTTING_HEIGHT,
    )
    operation = Facing2dOp(
        tool=tool,
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=FEEDRATE, spindle_rpm=RPM),
        clearance=AbsoluteClearance(absolute_height=CLEARANCE_PLANE_HEIGHT),
        levels=CAMLevels(
            drive_geometry_position="at_bottom",
            depth_of_cut=CUT_DEPTH,
            max_stepdown=Z_STEP_HEIGHT,
        ),
        drive_geometry=[
            ClosedPolyline25D(
                z=bottom_z,
                vertices=[Point2D(x=float(x), y=float(y)) for x, y, _ in corners]
                + [Point2D(x=float(corners[0][0]), y=float(corners[0][1]))],
            )
        ],
        cut_parameters=FacingCutSettings(
            cut_direction=CUT_DIRECTION,
            stepover=StepoverMode(mode="percentage_of_tool_diameter", value=STEPOVER),
            direction_degrees=DIRECTION_DEGREES,
        ),
    )
    return cam_engine(CAMSetup(), operation)


def toolpath_paths(operation: OperationRecord3D) -> list[dict[str, object]]:
    paths: list[dict[str, object]] = []
    points: list[list[float]] = []
    feed_type: str | None = None

    for record in operation.records:
        point = [float(record.x), float(record.y), float(record.z)]
        if feed_type != record.feed_type:
            if len(points) >= 2:
                paths.append(
                    {
                        "name": "Rapid moves" if feed_type == "rapid" else "Feed moves",
                        "points": points,
                    }
                )
            feed_type = record.feed_type
            points = points[-1:] if points else []
        points.append(point)

    if len(points) >= 2:
        paths.append(
            {
                "name": "Rapid moves" if feed_type == "rapid" else "Feed moves",
                "points": points,
            }
        )
    return paths


def prompt_curve(client: FileClient):
    original_timeout_seconds = client.timeout_seconds
    client.timeout_seconds = PROMPT_TIMEOUT_SECONDS
    try:
        return client.prompt_select_geometry(
            prompt=PROMPT,
            object_type="curve",
            require_enter=True,
        )
    finally:
        client.timeout_seconds = original_timeout_seconds


def path_payload(document_path: str, operation: OperationRecord3D) -> dict:
    return {
        "document_path": document_path,
        "parent_layer_name": TOOLPATH_PARENT_LAYER_NAME,
        "layer_name": TOOLPATH_LAYER_NAME,
        "paths": toolpath_paths(operation),
    }


def add_paths_to_rhino(document_path: str, operation: OperationRecord3D) -> str:
    REDIS.setex(PAYLOAD_KEY, 60, json.dumps(path_payload(document_path, operation)))
    result = run_script(RHINO_ADD_TOOLPATH_SCRIPT, capture_output=True, print_in_rhino=False)
    if not result["success"]:
        raise RuntimeError(result["output"].strip() or "Rhino failed to add toolpaths.")
    return result["output"].strip()


def self_check():
    corners = (
        (0.0, 0.0, 5.0),
        (100.0, 0.0, 5.0),
        (100.0, 100.0, 5.0),
        (0.0, 100.0, 5.0),
    )
    operation = build_operation(corners)
    assert operation.records, "facing produced no records"
    payload = path_payload("/tmp/test.3dm", operation)
    assert payload["paths"], "facing payload has no drawable paths"
    print("self-check passed")


def main():
    reset_rhino_environment()

    document_path = current_document_path()
    if not document_path:
        raise RuntimeError("Could not determine active Rhino document path.")

    client = FileClient(file_path=document_path)
    selected_curve = prompt_curve(client)
    if selected_curve is None:
        raise SystemExit("No curve returned from Rhino.")

    corners = rectangle_corners_from_geometry(selected_curve)
    operation = build_operation(corners)
    if not operation.records:
        raise RuntimeError("CAM engine returned no toolpath records.")

    current_path = current_document_path(pipe_id=client.pipe_id)
    if current_path != document_path:
        raise RuntimeError("Active Rhino document changed while the script was running.")

    output = add_paths_to_rhino(document_path, operation)
    print(output or f"Added toolpaths to {TOOLPATH_PARENT_LAYER_NAME}->{TOOLPATH_LAYER_NAME}.")
    print(f"Generated {len(operation.records)} cutter-location records.")


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        self_check()
    else:
        main()
