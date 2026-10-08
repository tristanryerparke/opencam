#!/usr/bin/env python3
"""Generate a 3-axis parallel-finishing toolpath from a selected Rhino mesh.

Run from the repository while Rhino is open and its RhinoCode pipe is running:

    uv run graphics/rhino_parallel_finishing_toolpath.py
"""

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
from opencam.schemas.operations.base import FeedsAndSpeeds
from opencam.schemas.operations.parallel_finishing import (
    ParallelFinishingCutSettings,
    ParallelFinishingOp,
)
from opencam.schemas.operations.pocketing import StepoverMode
from opencam.schemas.tools import BallTool
from opencam.schemas.mesh import Mesh
from opencam.services.cam_engine import cam_engine
from opencam.utilities.silhouette import silhouette
from rhino_renderer.file_client import FileClient
from rhino_renderer.file_client import current_document_path
from rhino_renderer.file_client import reset_rhino_environment
from rhino_renderer.redis_utils import REDIS
from rhino_renderer.rhino_pipe import run_script

PAYLOAD_KEY = "opencam:rhino_toolpath_payload"
RHINO_ADD_TOOLPATH_SCRIPT = SCRIPT_DIR / "rhino_add_toolpaths.py"
TOOLPATH_PARENT_LAYER_NAME = "TOOLPATH"
TOOLPATH_LAYER_NAME = "PARALLEL_FINISHING"

TOOL_DIAMETER = 12.7
CUTTING_HEIGHT = 60.0
STEPOVER_PERCENT = 45
FEEDRATE = 800.0
RPM = 18_000


def rhino_mesh_to_mesh(rhino_mesh) -> Mesh:
    vertices = [
        (float(vertex.X), float(vertex.Y), float(vertex.Z))
        for vertex in rhino_mesh.Vertices
    ]
    faces: list[tuple[int, int, int]] = []
    for face in rhino_mesh.Faces:
        if hasattr(face, "A"):
            a, b, c, d = face.A, face.B, face.C, face.D
        else:
            a, b, c, d = face
        if d == c:
            faces.append((int(a), int(b), int(c)))
        else:
            faces.extend(
                [
                    (int(a), int(b), int(c)),
                    (int(a), int(c), int(d)),
                ]
            )
    return Mesh(vertices=vertices, faces=faces)


def build_operation(mesh):
    return ParallelFinishingOp(
        tool=BallTool(
            name="Rhino 3D finishing tool",
            tool_number=1,
            diameter=TOOL_DIAMETER,
            cutting_height=CUTTING_HEIGHT,
            shoulder_height=CUTTING_HEIGHT,
        ),
        feeds_and_speeds=FeedsAndSpeeds(
            cut_feedrate=FEEDRATE,
            spindle_rpm=RPM,
        ),
        drive_geometry=[silhouette(mesh)],
        cut_parameters=ParallelFinishingCutSettings(
            stepover=StepoverMode(
                mode="percentage_of_tool_diameter",
                value=STEPOVER_PERCENT,
            ),
        ),
    )


def toolpath_paths(operation: OperationRecord3D) -> list[dict[str, object]]:
    paths: list[dict[str, object]] = []
    points: list[list[float]] = []
    feed_type: str | None = None

    for record in operation.records:
        point = [float(record.x), float(record.y), float(record.z)]
        if feed_type != record.feed_type:
            if len(points) >= 2:
                paths.append({"name": "Rapid moves" if feed_type == "rapid" else "Feed moves", "points": points})
            feed_type = record.feed_type
            # Keep the transition point so a one-record rapid return is visible.
            points = points[-1:] if points else []
        points.append(point)

    if len(points) >= 2:
        paths.append({"name": "Rapid moves" if feed_type == "rapid" else "Feed moves", "points": points})
    return paths


def path_payload(document_path: str, operation: OperationRecord3D) -> dict[str, object]:
    return {
        "document_path": document_path,
        "parent_layer_name": TOOLPATH_PARENT_LAYER_NAME,
        "layer_name": TOOLPATH_LAYER_NAME,
        "paths": toolpath_paths(operation),
    }


def send_to_rhino(document_path: str, operation: OperationRecord3D) -> str:
    REDIS.setex(PAYLOAD_KEY, 60, json.dumps(path_payload(document_path, operation)))
    result = run_script(RHINO_ADD_TOOLPATH_SCRIPT, capture_output=True, print_in_rhino=False)
    if not result["success"]:
        raise RuntimeError(result["output"].strip() or "Rhino failed to add toolpaths.")
    return result["output"].strip()


def main() -> None:
    reset_rhino_environment()
    document_path = current_document_path()
    if not document_path:
        raise RuntimeError("Could not determine the active Rhino document path.")

    client = FileClient(file_path=document_path, timeout_seconds=45.0)
    selected_mesh = client.prompt_select_geometry(
        prompt="Select the 3D milling mesh",
        object_type="mesh",
        require_enter=True,
    )
    if selected_mesh is None:
        raise SystemExit("No mesh selected.")

    current_path = current_document_path(pipe_id=client.pipe_id)
    if current_path != document_path:
        raise RuntimeError("Active Rhino document changed while selecting the mesh.")

    mesh = rhino_mesh_to_mesh(selected_mesh)
    operation = cam_engine(CAMSetup(part_mesh=mesh), build_operation(mesh))
    if not operation.records:
        raise RuntimeError("CAM engine returned no toolpath records.")

    output = send_to_rhino(document_path, operation)
    print(output or f"Added toolpaths to {TOOLPATH_PARENT_LAYER_NAME}->{TOOLPATH_LAYER_NAME}.")
    print(f"Generated {len(operation.records)} records from the selected mesh.")


if __name__ == "__main__":
    main()
