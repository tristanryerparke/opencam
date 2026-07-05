from fastapi.testclient import TestClient
import pytest

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
            "kind": "pocket2d",
            "displayName": "2D Pocket 1",
            "controlGeometry": {
                "driveGeometry": {
                    "planeZ": 0.0,
                    "vertices": [
                        {"x": 0.0, "y": 0.0},
                        {"x": 10.0, "y": 0.0},
                        {"x": 10.0, "y": 6.0},
                        {"x": 0.0, "y": 6.0},
                    ],
                },
            },
            "cutParameters": {
                "cutDirection": "climb",
                "stepover": 50.0,
                "stockToLeave": 0.0,
                "pocketStrategy": "inside",
            },
            "material": {"feedrate": 100.0, "rpm": 1000},
            "tool": {
                "diameter": 2.0,
                "fluteLength": 10.0,
                "toolNumber": 1,
                "manualChange": False,
            },
            "clearance": {
                "clearancePlaneHeight": 5.0,
                "transferHeightMode": "clearancePlane",
                "transferHeightOffset": 5.0,
            },
            "levels": {
                "driveGeometryReference": "top",
                "topZ": 0.0,
                "bottomZ": -2.0,
                "maxCutDepth": 1.0,
            },
            "advanced": {
                "operationSorting": "shortestTravel",
                "cutTransitions": "clearance",
                "layerOrder": "perLayer",
                "chordalTolerance": 0.01,
            },
        },
    }


def test_generate_toolpath_request_rejects_transfer_height_below_top_z(pocket_request_payload: dict):
    pocket_request_payload["operation"]["clearance"]["clearancePlaneHeight"] = 0.0

    with pytest.raises(ValueError, match="Transfer height must be above the operation top Z"):
        GenerateToolpathRequest.model_validate(pocket_request_payload)


def test_cam_schema_endpoint_returns_generated_bundle():
    response = client.get("/cam/schema")

    assert response.status_code == 200
    payload = response.json()
    assert "generateToolpathRequest" in payload
    assert "pocket2dOperation" in payload
    assert payload["pocket2dOperation"]["title"] == "Pocket2DOperationConfig"


def test_generate_cam_toolpath_endpoint_returns_toolpaths(pocket_request_payload: dict):
    response = client.post("/cam/toolpath", json=pocket_request_payload)

    assert response.status_code == 200
    payload = response.json()
    assert payload["tool"]["diameter"] == 2.0
    assert payload["tool"]["cuttingHeight"] == 10.0
    assert len(payload["paths"]) >= 3
    assert payload["paths"][0]["kind"] == "clearance"
    assert payload["paths"][1]["kind"] == "cut"
