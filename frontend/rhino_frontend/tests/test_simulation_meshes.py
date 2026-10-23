import io
import json
import os
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))

from opencam_rhino.glb import parse_glb  # noqa: E402
from opencam_rhino.mesh_export import box_stl_bytes  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parents[3]


def test_glb_roundtrip_with_vertex_colors():
    import numpy as np
    import trimesh

    mesh = trimesh.creation.box(extents=(2.0, 3.0, 4.0))
    mesh.visual.vertex_colors = np.tile(
        np.array([0, 255, 0, 255], dtype=np.uint8), (len(mesh.vertices), 1)
    )
    parsed = parse_glb(mesh.export(file_type="glb"))
    assert len(parsed) == 1
    result = parsed[0]
    assert len(result["vertices"]) == len(mesh.vertices)
    assert len(result["faces"]) == len(mesh.faces)
    assert result["colors"] is not None
    assert result["colors"][0] == (0, 255, 0)


def test_box_stl_is_watertight_with_positive_volume():
    import trimesh

    data = box_stl_bytes((0.0, 0.0, 0.0), (10.0, 8.0, 6.0))
    mesh = trimesh.load(io.BytesIO(data), file_type="stl")
    assert mesh.is_watertight
    assert len(mesh.faces) == 12
    assert abs(mesh.volume - 480.0) < 1e-6


@pytest.mark.skipif(bool(os.environ.get("OPENCA_RHINO_SKIP_INTEGRATION")), reason="explicit skip")
def test_simulate_contract_end_to_end():
    """Drive the real app exactly the way the Rhino actions will."""
    from fastapi.testclient import TestClient
    from opencam_contracts.cam import GenerateToolpathRequest
    from opencam_contracts.geometry_2_5d import ClosedPolyline25D
    from opencam_contracts.geometry_2d import Point2D
    from opencam_contracts.operations.base import CAMLevels, FeedsAndSpeeds
    from opencam_contracts.operations.pocketing import Pocketing2dOp, PocketingCutSettings, StepoverMode
    from opencam_contracts.setup import CAMSetup
    from opencam_contracts.tools import CylindricalTool

    sys.path.insert(0, str(REPO_ROOT / "src"))
    from server.main import app  # noqa: E402  (src/server is not part of the wheel)

    operation = Pocketing2dOp(
        tool=CylindricalTool(name="6mm flat", tool_number=1, diameter=6.0, cutting_height=10.0, shoulder_height=10.0),
        clearance={"clearance_height_type": "absolute", "absolute_height": 15.0},
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18000),
        levels=CAMLevels(depth_of_cut=5.0),
        cut_parameters=PocketingCutSettings(stepover=StepoverMode(mode="percentage_of_tool_diameter", value=40)),
        drive_geometry=[ClosedPolyline25D(z=5.0, vertices=[Point2D(x=x, y=y) for x, y in ((1, 1), (17, 1), (17, 17), (1, 17), (1, 1))])],
    )
    request = GenerateToolpathRequest(setup=CAMSetup(), operation=operation)

    client = TestClient(app)
    response = client.post("/cam/toolpath", json=json.loads(request.model_dump_json(by_alias=True)))
    assert response.status_code == 200, response.text
    toolpath = response.json()
    assert toolpath["records"], "toolpath generation returned no records"

    start = client.post(
        "/simulate",
        files={"mesh": ("stock.stl", box_stl_bytes((0.0, 0.0, 0.0), (18.0, 18.0, 10.0)))},
        data={"operation": json.dumps(toolpath), "chunk_step_distance": "2.0"},
    )
    assert start.status_code == 200, start.text
    task_id = start.json()["taskId"]

    deadline = time.monotonic() + 180.0
    while True:
        status = client.get(f"/simulate/{task_id}/status").json()
        assert status["status"] != "error", status.get("errorDetail")
        if status["status"] == "completed":
            break
        assert time.monotonic() < deadline, "simulation did not complete in time"
        time.sleep(0.5)

    result = status["result"]
    assert result["frameCount"] > 0
    assert result["chunks"]

    tool_mesh = client.get(result["toolMeshUrl"])
    assert tool_mesh.status_code == 200
    assert parse_glb(tool_mesh.content), "tool mesh GLB did not parse"

    chunk = result["chunks"][0]
    cached = client.get(chunk["cachedMeshUrl"])
    assert cached.status_code == 200
    assert parse_glb(cached.content)

    frame = chunk["frames"][0]
    active = client.get(f"/simulate/{result['simulationId']}/chunks/0/active-meshes/{frame['activeMeshIndex']}.glb")
    assert active.status_code == 200
    assert parse_glb(active.content)

    final = client.get(f"/simulate/{result['simulationId']}/final-mesh.glb")
    assert final.status_code == 200
    assert parse_glb(final.content)

    comparison = client.get(f"/simulate/{result['simulationId']}/comparison")
    assert comparison.status_code == 200, comparison.text
    comparison_mesh = client.get(comparison.json()["activeMeshUrl"])
    assert comparison_mesh.status_code == 200
    parsed = parse_glb(comparison_mesh.content)
    assert parsed and any(mesh["colors"] for mesh in parsed), "comparison mesh lacks vertex colors"


@pytest.mark.skipif(bool(os.environ.get("OPENCA_RHINO_SKIP_INTEGRATION")), reason="explicit skip")
def test_simulate_contract_without_stock_data():
    """include_stock_data=false returns tool animation without generating stock meshes."""
    from fastapi.testclient import TestClient
    from opencam_contracts.cam import GenerateToolpathRequest
    from opencam_contracts.geometry_2_5d import ClosedPolyline25D
    from opencam_contracts.geometry_2d import Point2D
    from opencam_contracts.operations.base import CAMLevels, FeedsAndSpeeds
    from opencam_contracts.operations.pocketing import Pocketing2dOp, PocketingCutSettings, StepoverMode
    from opencam_contracts.setup import CAMSetup
    from opencam_contracts.tools import CylindricalTool

    sys.path.insert(0, str(REPO_ROOT / "src"))
    from server.main import app  # noqa: E402  (src/server is not part of the wheel)

    operation = Pocketing2dOp(
        tool=CylindricalTool(name="6mm flat", tool_number=1, diameter=6.0, cutting_height=10.0, shoulder_height=10.0),
        clearance={"clearance_height_type": "absolute", "absolute_height": 15.0},
        feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18000),
        levels=CAMLevels(depth_of_cut=5.0),
        cut_parameters=PocketingCutSettings(stepover=StepoverMode(mode="percentage_of_tool_diameter", value=40)),
        drive_geometry=[ClosedPolyline25D(z=5.0, vertices=[Point2D(x=x, y=y) for x, y in ((1, 1), (17, 1), (17, 17), (1, 17), (1, 1))])],
    )
    request = GenerateToolpathRequest(setup=CAMSetup(), operation=operation)

    client = TestClient(app)
    response = client.post("/cam/toolpath", json=json.loads(request.model_dump_json(by_alias=True)))
    assert response.status_code == 200, response.text
    toolpath = response.json()

    start = client.post(
        "/simulate",
        data={
            "operation": json.dumps(toolpath),
            "chunk_step_distance": "2.0",
            "include_stock_data": "false",
        },
    )
    assert start.status_code == 200, start.text
    task_id = start.json()["taskId"]

    deadline = time.monotonic() + 180.0
    while True:
        status = client.get(f"/simulate/{task_id}/status").json()
        assert status["status"] != "error", status.get("errorDetail")
        if status["status"] == "completed":
            break
        assert time.monotonic() < deadline, "simulation did not complete in time"
        time.sleep(0.5)

    result = status["result"]
    assert result["frameCount"] > 0
    assert result["finalMeshUrl"] == ""
    chunk = result["chunks"][0]
    assert chunk["cachedMeshUrl"] == ""
    assert chunk["frames"][0]["activeMeshIndex"] == -1
    assert chunk["frames"][0]["toolPosition"]

    tool_mesh = client.get(result["toolMeshUrl"])
    assert tool_mesh.status_code == 200
    assert parse_glb(tool_mesh.content), "tool mesh GLB did not parse"
