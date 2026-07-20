from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from opencam.schemas.cam import GenerateToolpathRequest
from server.main import app


client = TestClient(app)


@pytest.fixture
def pocket_request_payload() -> dict:
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
            "tool": {
                "id": "tool-2mm",
                "name": "2mm flat end mill",
                "type": "cylinder",
                "toolNumber": 1,
                "diameter": 2.0,
                "cuttingHeight": 10.0,
                "shoulderHeight": 12.0,
            },
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
            "driveGeometry": {
                "cutAreas": [
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
            },
            "cutParameters": {
                "cutDirection": "climb",
                "stepover": {"mode": "percentage_of_tool_diameter", "value": 50.0},
                "stockToLeave": 0.0,
            },
        },
    }


def test_generate_toolpath_request_rejects_clearance_below_top_z(pocket_request_payload: dict):
    pocket_request_payload["operation"]["clearance"]["absoluteHeight"] = 0.0

    with pytest.raises(ValueError, match="Clearance height must be above the operation top Z"):
        GenerateToolpathRequest.model_validate(pocket_request_payload)


def test_generate_cam_toolpath_endpoint_returns_cl_data(pocket_request_payload: dict):
    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    payload = response.json()
    assert payload["tool"]["id"] == "tool-2mm"
    assert len(payload["records"]) >= 3
    assert payload["records"][0]["feedType"] == "rapid"
    assert any(record["feedType"] == "feed_rate" for record in payload["records"])


def test_generate_cam_toolpath_connects_multiple_pockets_with_xy_travel(pocket_request_payload: dict):
    pocket_request_payload["operation"]["driveGeometry"]["cutAreas"].append(
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
    pocket_request_payload["operation"]["driveGeometry"]["cutAreas"].append(
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


def test_non_cylindrical_tools_are_not_implemented(pocket_request_payload: dict):
    payload = deepcopy(pocket_request_payload)
    payload["operation"]["tool"] = {
        **payload["operation"]["tool"],
        "type": "ball",
    }

    response = client.post("/cam/toolpath", json=payload)

    assert response.status_code == 501
    assert "not supported" in response.json()["detail"]
