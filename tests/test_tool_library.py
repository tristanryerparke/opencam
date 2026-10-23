from fastapi.testclient import TestClient

from opencam_contracts.tools import BallTool, CylindricalTool
from opencam.services.tool_library import ToolLibrary, get_tool_library
from opencam.services.tool_mesh import TOOL_SEGMENTS, build_tool_mesh_vertices_faces
from server.main import app


def cylindrical_tool(**values):
    return CylindricalTool(
        id="tool-6mm-flat",
        name="6mm flat end mill",
        tool_number=7,
        diameter=6.0,
        cutting_height=20.0,
        shoulder_height=30.0,
        **values,
    )


def test_tool_library_persists_tools(tmp_path):
    db_path = tmp_path / "opencam.json"
    library = ToolLibrary(db_path)
    library.add_tool(cylindrical_tool())
    library.close()

    reopened = ToolLibrary(db_path)
    try:
        assert reopened.list_tools() == [cylindrical_tool()]
    finally:
        reopened.close()


def test_cam_tool_endpoints_add_and_list_records(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    tool_payload = {
        "id": "tool-1",
        "name": "3.175mm flat end mill",
        "type": "cylinder",
        "toolNumber": 1,
        "manualChange": True,
        "diameter": 3.175,
        "cuttingHeight": 12.7,
        "shoulderHeight": 20.0,
        "numFlutes": 2,
    }

    try:
        with TestClient(app) as client:
            response = client.post("/cam/tools", json=tool_payload)
            assert response.status_code == 201
            expected = CylindricalTool.model_validate(tool_payload).model_dump(mode="json", by_alias=True)
            assert response.json() == expected
            assert client.get("/cam/tools").json() == [expected]
    finally:
        app.dependency_overrides.clear()
        library.close()


def test_cam_tool_endpoint_updates_and_deletes_records(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    tool_payload = {
        "id": "tool-1",
        "name": "6mm flat end mill",
        "type": "cylinder",
        "toolNumber": 1,
        "manualChange": False,
        "diameter": 6.0,
        "cuttingHeight": 18.0,
        "shoulderHeight": 25.0,
        "numFlutes": 2,
    }

    try:
        with TestClient(app) as client:
            assert client.post("/cam/tools", json=tool_payload).status_code == 201
            updated = {**tool_payload, "diameter": 6.35, "manualChange": True}
            expected_updated = CylindricalTool.model_validate(updated).model_dump(mode="json", by_alias=True)
            assert client.put("/cam/tools/tool-1", json=updated).json() == expected_updated
            assert client.get("/cam/tools/tool-1").json() == expected_updated
            assert client.put("/cam/tools/tool-1", json={**updated, "id": "other-tool"}).status_code == 400
            assert client.delete("/cam/tools/tool-1").status_code == 204
            assert client.get("/cam/tools/tool-1").status_code == 404
    finally:
        app.dependency_overrides.clear()
        library.close()


def test_ball_tool_mesh_uses_the_tool_definition():
    tool = BallTool(
        id="tool-ball-6mm",
        name="6mm ball end mill",
        tool_number=4,
        diameter=6.0,
        cutting_height=10.0,
        shoulder_height=20.0,
    )

    vertices, faces = build_tool_mesh_vertices_faces(tool)

    assert vertices[:, 2].min() == 0.0
    assert vertices[:, 2].max() == 10.0
    assert round(float((vertices[:, 0] ** 2 + vertices[:, 1] ** 2).max() ** 0.5), 6) == 3.0
    assert len(faces) == TOOL_SEGMENTS * 10


def test_cam_tool_endpoint_requires_a_type(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            response = client.post(
                "/cam/tools",
                json={"id": "tool-1", "name": "6mm flat end mill", "toolNumber": 1, "diameter": 6.0, "cuttingHeight": 18.0, "shoulderHeight": 25.0},
            )
            assert response.status_code == 422
    finally:
        app.dependency_overrides.clear()
        library.close()


def test_tool_endpoints_reject_duplicate_ids(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            tool_payload = {
                "id": "tool-1",
                "name": "6mm flat end mill",
                "type": "cylinder",
                "toolNumber": 1,
                "diameter": 6.0,
                "cuttingHeight": 18.0,
                "shoulderHeight": 25.0,
            }
            assert client.post("/cam/tools", json=tool_payload).status_code == 201
            assert client.post("/cam/tools", json=tool_payload).status_code == 409
    finally:
        app.dependency_overrides.clear()
        library.close()
