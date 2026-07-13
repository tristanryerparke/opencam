from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from opencam.schemas.operations.base import FeedsAndSpeeds, Material, Tool, ToolMaterialFeedsAndSpeeds
from opencam.schemas.cam import GenerateToolpathRequest
from opencam.services.tool_library import ToolLibrary, get_tool_library
from server.main import app


client = TestClient(app)


@pytest.fixture
def tool_library(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    library.add_tool(
        Tool(
            id="tool-2mm",
            name="2mm flat end mill",
            diameter=2.0,
            flute_length=10.0,
            shoulder_length=12.0,
            tool_number=1,
        )
    )
    app.dependency_overrides[get_tool_library] = lambda: library
    yield library
    app.dependency_overrides.clear()
    library.close()


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
            "kind": "pocket2d",
            "displayName": "2D Pocket 1",
            "toolId": "tool-2mm",
            "feedsAndSpeeds": {
                "mode": "manual",
                "feedsAndSpeeds": {
                    "spindleRpm": 1000,
                    "plungeFeedrate": 50.0,
                    "leadInFeedrate": 100.0,
                    "cutFeedrate": 100.0,
                    "leadOutFeedrate": 100.0,
                    "departureFeedrate": 100.0,
                },
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
                        "planeZ": 0.0,
                        "vertices": [
                            {"x": 0.0, "y": 0.0},
                            {"x": 10.0, "y": 0.0},
                            {"x": 10.0, "y": 6.0},
                            {"x": 0.0, "y": 6.0},
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


def test_generate_cam_toolpath_endpoint_returns_toolpaths(tool_library, pocket_request_payload: dict):
    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    payload = response.json()
    assert payload["toolId"] == "tool-2mm"
    assert len(payload["records"]) >= 3
    assert payload["records"][0]["feedType"] == "rapid"
    assert any(record["feedType"] == "feed_rate" for record in payload["records"])


def test_generate_cam_toolpath_connects_multiple_pockets_with_xy_travel(tool_library, pocket_request_payload: dict):
    pocket_request_payload["operation"]["driveGeometry"]["cutAreas"].append(
        {
            "planeZ": 0.0,
            "vertices": [
                {"x": 20.0, "y": 0.0},
                {"x": 30.0, "y": 0.0},
                {"x": 30.0, "y": 6.0},
                {"x": 20.0, "y": 6.0},
            ],
        }
    )

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    travel = next(record for record in response.json()["records"] if record["comment"] == "travel to next pocket")
    assert travel["feedType"] == "rapid"
    assert travel["z"] == 5.0


def test_generate_cam_toolpath_shifts_pockets_without_changing_cut_depth(tool_library, pocket_request_payload: dict):
    pocket_request_payload["operation"]["driveGeometry"]["cutAreas"].append(
        {
            "planeZ": 3.0,
            "vertices": [
                {"x": 20.0, "y": 0.0},
                {"x": 30.0, "y": 0.0},
                {"x": 30.0, "y": 6.0},
                {"x": 20.0, "y": 6.0},
            ],
        }
    )

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    cut_records = [
        record for record in response.json()["records"] if record["feedType"] == "feed_rate"
    ]
    first_pocket_z = {record["z"] for record in cut_records if record["x"] < 20.0}
    second_pocket_z = {record["z"] for record in cut_records if record["x"] >= 20.0}
    assert first_pocket_z == {-2.0, -1.0}
    assert second_pocket_z == {1.0, 2.0}


def test_absolute_stepover_is_converted_for_the_pocket_engine(tool_library, pocket_request_payload: dict):
    pocket_request_payload["operation"]["cutParameters"]["stepover"] = {
        "mode": "absolute",
        "value": 1.0,
    }

    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200


def test_tool_material_feeds_and_speeds_selection(tool_library, pocket_request_payload: dict):
    tool_library.add_material(Material(id="material-6061", name="6061 Aluminum"))
    tool_library.add_tool_material_feeds_and_speeds(
        ToolMaterialFeedsAndSpeeds(
            id="tool-2mm-6061",
            tool_id="tool-2mm",
            material_id="material-6061",
            feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=250.0),
        )
    )
    payload = deepcopy(pocket_request_payload)
    payload["operation"]["feedsAndSpeeds"] = {
        "mode": "tool_material",
        "materialId": "material-6061",
        "toolMaterialFeedsAndSpeedsId": "tool-2mm-6061",
    }

    response = client.post("/cam/toolpath", json=payload)

    assert response.status_code == 200
