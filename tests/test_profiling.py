from fastapi.testclient import TestClient

from opencam.schemas.tools import CylindricalTool
from opencam.services.tool_mesh import build_tool
from server.main import app


client = TestClient(app)


def profile_payload(*, side="outside", kind="polyline", stock_to_leave=0.0):
    vertices = [
        {"x": 0.0, "y": 0.0},
        {"x": 10.0, "y": 0.0},
    ]
    if kind == "closed_polyline":
        vertices = [
            {"x": 0.0, "y": 0.0},
            {"x": 10.0, "y": 0.0},
            {"x": 10.0, "y": 6.0},
            {"x": 0.0, "y": 6.0},
            {"x": 0.0, "y": 0.0},
        ]

    return {
        "setup": {"stock": {"maxZ": 0.0}},
        "operation": {
            "type": "profiling_2d",
            "tool": build_tool(
                CylindricalTool(
                    id="tool-2mm",
                    name="2mm flat end mill",
                    tool_number=1,
                    diameter=2.0,
                    cutting_height=10.0,
                    shoulder_height=12.0,
                )
            ).model_dump(mode="json", by_alias=True),
            "clearance": {"clearanceHeightType": "absolute", "absoluteHeight": 5.0},
            "levels": {"driveGeometryPosition": "at_top", "depthOfCut": 2.0, "maxStepdown": 1.0},
            "advanced": {"chordalTolerance": 0.01},
            "driveGeometry": [{"kind": kind, "z": 0.0, "vertices": vertices}],
            "cutParameters": {"side": side, "stockToLeave": stock_to_leave},
        },
    }


def feed_records(payload):
    response = client.post("/cam/toolpath", json=payload)
    assert response.status_code == 200, response.text
    return [record for record in response.json()["records"] if record["feedType"] == "feed_rate"]


def test_open_profile_offsets_left_or_right_and_uses_stepdown():
    outside = feed_records(profile_payload(side="outside"))
    inside = feed_records(profile_payload(side="inside"))

    assert {(record["y"], record["z"]) for record in outside} == {(1.0, -1.0), (1.0, -2.0)}
    assert {(record["y"], record["z"]) for record in inside} == {(-1.0, -1.0), (-1.0, -2.0)}


def test_profile_applies_stock_to_leave():
    records = feed_records(profile_payload(stock_to_leave=0.5))

    assert {record["y"] for record in records} == {1.5}



def test_closed_profile_uses_cam_toolpath_endpoint():
    records = feed_records(profile_payload(kind="closed_polyline"))

    assert (min(record["x"] for record in records), max(record["x"] for record in records)) == (-1.0, 11.0)
    assert (min(record["y"] for record in records), max(record["y"] for record in records)) == (-1.0, 7.0)


def test_legacy_profile_endpoint_is_removed():
    assert client.post("/profile/closed", json={}).status_code == 404
