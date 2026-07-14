from fastapi.testclient import TestClient

from opencam.schemas.operations.base import Material
from opencam.schemas.tools import CylindricalTool
from opencam.services.tool_library import ToolLibrary, get_tool_library
from server.main import app


def cylindrical_tool(**values) -> CylindricalTool:
    return CylindricalTool(
        id="tool-6mm-flat",
        name="6mm flat end mill",
        tool_number=7,
        diameter=6.0,
        cutting_height=20.0,
        shoulder_height=30.0,
        **values,
    )


def test_tool_library_persists_tools_and_materials(tmp_path):
    db_path = tmp_path / "opencam.json"
    library = ToolLibrary(db_path)
    library.add_material(Material(id="material-6061", name="6061 Aluminum"))
    library.add_tool(cylindrical_tool())
    library.close()

    reopened = ToolLibrary(db_path)
    try:
        assert reopened.list_materials() == [Material(id="material-6061", name="6061 Aluminum")]
        assert reopened.list_tools() == [cylindrical_tool()]
    finally:
        reopened.close()


def test_cam_tool_and_material_endpoints_add_and_list_records(tmp_path):
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
            material_response = client.post(
                "/cam/materials",
                json={"id": "material-walnut", "name": "Walnut"},
            )
            assert material_response.status_code == 201

            tool_response = client.post("/cam/tools", json=tool_payload)
            assert tool_response.status_code == 201
            assert tool_response.json() == tool_payload

            assert client.get("/cam/materials").json() == [{"id": "material-walnut", "name": "Walnut"}]
            assert client.get("/cam/tools").json() == [tool_payload]
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
            updated_tool_payload = {**tool_payload, "diameter": 6.35, "manualChange": True}
            assert client.put("/cam/tools/tool-1", json=updated_tool_payload).json() == updated_tool_payload
            assert client.get("/cam/tools/tool-1").json() == updated_tool_payload
            assert client.put("/cam/tools/tool-1", json={**updated_tool_payload, "id": "other-tool"}).status_code == 400
            assert client.delete("/cam/tools/tool-1").status_code == 204
            assert client.get("/cam/tools/tool-1").status_code == 404
    finally:
        app.dependency_overrides.clear()
        library.close()


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


def test_tool_and_material_endpoints_reject_duplicate_ids(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            material_payload = {"id": "material-1", "name": "MDF"}
            assert client.post("/cam/materials", json=material_payload).status_code == 201
            assert client.post("/cam/materials", json=material_payload).status_code == 409

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
