from __future__ import annotations

import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SRC_DIR = PROJECT_ROOT / "src"
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from opencam.schemas.models import ClosedPolyline
from opencam.schemas.models import Point2D
from opencam.schemas.models import Tool
from opencam.services.operations.pocketing.operation import ClosedPocketingEngine
from rhino_renderer.file_client import FileClient
from rhino_renderer.file_client import current_document_path
from rhino_renderer.file_client import reset_rhino_environment
from rhino_renderer.redis_utils import REDIS
from rhino_renderer.rhino_pipe import run_script

PROMPT = "Select one closed curve at the bottom of the pocket"
TOOLPATH_PARENT_LAYER_NAME = "TOOLPATH"
TOOLPATH_LAYER_NAME = "POCKETING"
PROMPT_TIMEOUT_SECONDS = 45.0
PAYLOAD_KEY = "opencam:rhino_toolpath_payload"
RHINO_ADD_TOOLPATH_SCRIPT = SCRIPT_DIR / "rhino_add_toolpaths.py"

TOOL_DIAMETER = 20
CUTTING_HEIGHT = 30
CUT_DEPTH = 6.0
Z_STEP_HEIGHT = 20
STEPOVER = 45
STOCK_TO_LEAVE = 0.0
FEEDRATE = 500.0
RPM = 12000
TOOL_ID = "rhino-pocket-tool"
CLEARANCE_PLANE_HEIGHT = 50


def point_distance(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def polyline_points_from_geometry(geometry) -> list[tuple[float, float, float]]:
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
    if len(points) < 4:
        raise ValueError("Selected curve must contain at least 4 polyline points.")
    if point_distance(points[0], points[-1]) > 1e-6:
        raise ValueError("Selected curve must be closed.")
    return points


def z_level_from_points(points: list[tuple[float, float, float]]) -> float:
    z_level = points[0][2]
    for _, _, z in points[1:]:
        if abs(z - z_level) > 1e-6:
            raise ValueError("Selected curve must be planar in Z.")
    return float(z_level)


def closed_polyline_from_points(points: list[tuple[float, float, float]]) -> ClosedPolyline:
    return ClosedPolyline(
        vertices=[Point2D(x=float(x), y=float(y)) for x, y, _ in points[:-1]]
    )


def build_operation(points: list[tuple[float, float, float]]):
    if CUT_DEPTH <= 0:
        raise ValueError("CUT_DEPTH must be greater than 0.")

    bottom_z = z_level_from_points(points)
    top_z = bottom_z + CUT_DEPTH
    if CLEARANCE_PLANE_HEIGHT <= top_z:
        raise ValueError("CLEARANCE_PLANE_HEIGHT must be above the top of the cut.")

    engine = ClosedPocketingEngine(
        ring=closed_polyline_from_points(points),
        tool=Tool(diameter=TOOL_DIAMETER, cutting_height=CUTTING_HEIGHT),
        tool_id=TOOL_ID,
        feedrate=FEEDRATE,
        rpm=RPM,
        clearance_plane_height=CLEARANCE_PLANE_HEIGHT,
        z_bounds=(top_z, bottom_z),
        z_step_height=Z_STEP_HEIGHT,
        stepover=STEPOVER,
        stock_to_leave=STOCK_TO_LEAVE,
    )
    return engine.process()


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


def path_payload(document_path: str, records) -> dict:
    return {
        "document_path": document_path,
        "parent_layer_name": TOOLPATH_PARENT_LAYER_NAME,
        "layer_name": TOOLPATH_LAYER_NAME,
        "paths": [
            {
                "name": "Pocketing",
                "points": [[float(record.x), float(record.y), float(record.z)] for record in records],
            }
        ] if len(records) >= 2 else [],
    }


def add_paths_to_rhino(document_path: str, records) -> str:
    REDIS.setex(PAYLOAD_KEY, 60, json.dumps(path_payload(document_path, records)))
    result = run_script(RHINO_ADD_TOOLPATH_SCRIPT, capture_output=True, print_in_rhino=False)
    if not result["success"]:
        raise RuntimeError(result["output"].strip() or "Rhino failed to add toolpaths.")
    return result["output"].strip()


def self_check():
    points = [
        (0.0, 0.0, 5.0),
        (100.0, 0.0, 5.0),
        (100.0, 100.0, 5.0),
        (0.0, 100.0, 5.0),
        (0.0, 0.0, 5.0),
    ]
    ring = closed_polyline_from_points(points)
    assert len(ring.vertices) == 4
    assert z_level_from_points(points) == 5.0
    assert path_payload("/tmp/test.3dm", build_operation(points))["paths"]
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

    points = polyline_points_from_geometry(selected_curve)
    records = build_operation(points)

    current_path = current_document_path(pipe_id=client.pipe_id)
    if current_path != document_path:
        raise RuntimeError("Active Rhino document changed while the script was running.")

    output = add_paths_to_rhino(document_path, records)
    print(output or f"Added toolpaths to {TOOLPATH_PARENT_LAYER_NAME}->{TOOLPATH_LAYER_NAME}.")
    print(f"Generated {len(records)} cutter-location records.")


if __name__ == "__main__":
    if "--self-check" in sys.argv:
        self_check()
    else:
        main()
