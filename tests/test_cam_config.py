from copy import deepcopy
import logging

import pytest
from fastapi.testclient import TestClient

import server.main as server_main
from opencam_contracts.tools import BallTool, CylindricalTool
from opencam.services.tool_mesh import build_tool
from server.main import app


client = TestClient(app)


@pytest.fixture
def pocket_request_payload() -> dict:
    tool = build_tool(
        CylindricalTool(
            id="tool-2mm",
            name="2mm flat end mill",
            tool_number=1,
            diameter=2.0,
            cutting_height=10.0,
            shoulder_height=12.0,
        )
    ).model_dump(mode="json", by_alias=True)
    return {
        "setup": {
            "origin": {"x": 0, "y": 0, "z": 0},
            "orientation": {"machineZAxis": "positiveZ"},
            "stock": {"maxZ": 0.0},
        },
        "operation": {
            "id": "pocket-1",
            "type": "pocketing_2d",
            "displayName": "2D Pocket 1",
            "tool": tool,
            "feedsAndSpeeds": {
                "spindleRpm": 1000,
                "plungeFeedrate": 50.0,
                "leadInFeedrate": 100.0,
                "cutFeedrate": 100.0,
                "leadOutFeedrate": 100.0,
                "departureFeedrate": 100.0,
            },
            "clearance": {
                "clearanceHeightType": "absolute",
                "absoluteHeight": 5.0,
            },
            "levels": {
                "driveGeometryPosition": "at_top",
                "depthOfCut": 2.0,
                "maxStepdown": 1.0,
            },
            "advanced": {
                "operationsSorting": "selection",
                "chordalTolerance": 0.01,
            },
            "driveGeometry": [
                {
                    "z": 0.0,
                    "vertices": [
                        {"x": 0.0, "y": 0.0},
                        {"x": 10.0, "y": 0.0},
                        {"x": 10.0, "y": 6.0},
                        {"x": 0.0, "y": 6.0},
                        {"x": 0.0, "y": 0.0},
                    ],
                },
            ],
            "cutParameters": {
                "cutDirection": "climb",
                "stepover": {"mode": "percentage_of_tool_diameter", "value": 50.0},
                "stockToLeave": 0.0,
            },
        },
    }


def test_generate_cam_toolpath_rejects_clearance_below_top_z(pocket_request_payload: dict):
    pocket_request_payload["operation"]["clearance"]["absoluteHeight"] = 0.0

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 400
    assert "Clearance height must be above the operation top Z" in response.json()["detail"]


def test_automatic_clearance_uses_highest_part_stock_or_operation_z(pocket_request_payload: dict):
    pocket_request_payload["setup"]["stock"]["maxZ"] = 3.0
    pocket_request_payload["setup"]["partMesh"] = {
        "source": "inline",
        "vertices": [[0.0, 0.0, 20.0], [1.0, 0.0, 20.0], [0.0, 1.0, 20.0]],
        "faces": [[0, 1, 2]],
    }
    pocket_request_payload["operation"]["clearance"] = {"clearanceHeightType": "automatic"}
    pocket_request_payload["operation"]["levels"]["driveGeometryPosition"] = "at_bottom"

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    assert response.json()["clearancePlaneHeight"] == 30.0


def test_parallel_finishing_requires_a_part_mesh(pocket_request_payload: dict):
    payload = deepcopy(pocket_request_payload)
    payload["operation"]["type"] = "parallel_finishing"

    response = client.post("/cam/toolpath", json=payload)

    assert response.status_code == 422
    assert "Parallel finishing requires a part mesh in the CAM setup." in response.text


def test_generate_cam_toolpath_reports_and_logs_generation_errors(
    pocket_request_payload: dict,
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
):
    def fail(*args, **kwargs):
        raise ValueError("toolpath generation failed")

    monkeypatch.setattr(server_main, "cam_engine", fail)
    with caplog.at_level(logging.ERROR, logger="server.main"):
        response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 400
    assert response.json() == {"detail": "ValueError: toolpath generation failed"}
    assert "CAM toolpath generation failed" in caplog.text
    assert "toolpath generation failed" in caplog.text


def test_generate_cam_toolpath_endpoint_returns_cl_data(pocket_request_payload: dict):
    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    payload = response.json()
    assert payload["tool"]["id"] == "tool-2mm"
    assert len(payload["records"]) >= 3
    assert payload["records"][0]["feedType"] == "rapid"
    assert any(record["feedType"] == "feed_rate" for record in payload["records"])


def test_generate_cam_toolpath_connects_multiple_pockets_with_xy_travel(pocket_request_payload: dict):
    pocket_request_payload["operation"]["driveGeometry"].append(
        {
            "z": 0.0,
            "vertices": [
                {"x": 20.0, "y": 0.0},
                {"x": 30.0, "y": 0.0},
                {"x": 30.0, "y": 6.0},
                {"x": 20.0, "y": 6.0},
                {"x": 20.0, "y": 0.0},
            ],
        }
    )

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    travel = next(record for record in response.json()["records"] if record["comment"] == "travel to next pocket")
    assert travel["feedType"] == "rapid"
    assert travel["z"] == 5.0


def test_generate_cam_toolpath_shifts_pockets_without_changing_cut_depth(pocket_request_payload: dict):
    pocket_request_payload["operation"]["driveGeometry"].append(
        {
            "z": 3.0,
            "vertices": [
                {"x": 20.0, "y": 0.0},
                {"x": 30.0, "y": 0.0},
                {"x": 30.0, "y": 6.0},
                {"x": 20.0, "y": 6.0},
                {"x": 20.0, "y": 0.0},
            ],
        }
    )

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    cut_records = [record for record in response.json()["records"] if record["feedType"] == "feed_rate"]
    first_pocket_z = {record["z"] for record in cut_records if record["x"] < 20.0}
    second_pocket_z = {record["z"] for record in cut_records if record["x"] >= 20.0}
    assert first_pocket_z == {-2.0, -1.0}
    assert second_pocket_z == {1.0, 2.0}


def test_absolute_stepover_is_converted_for_the_pocket_engine(pocket_request_payload: dict):
    pocket_request_payload["operation"]["cutParameters"]["stepover"] = {
        "mode": "absolute",
        "value": 1.0,
    }

    assert client.post("/cam/toolpath", json=pocket_request_payload).status_code == 200


def test_ball_tools_are_supported(pocket_request_payload: dict):
    payload = deepcopy(pocket_request_payload)
    payload["operation"]["tool"] = build_tool(
        BallTool(
            id="tool-2mm-ball",
            name="2mm ball end mill",
            tool_number=1,
            diameter=2.0,
            cutting_height=10.0,
            shoulder_height=12.0,
        )
    ).model_dump(mode="json", by_alias=True)

    response = client.post("/cam/toolpath", json=payload)

    assert response.status_code == 200
    assert response.json()["tool"]["type"] == "ball"
