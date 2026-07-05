from fastapi.testclient import TestClient

from opencam.schemas.tool_library import Material, Tool
from opencam.services.tool_library import ToolLibrary, get_tool_library
from server.main import app


def test_tool_library_persists_tools_and_materials(tmp_path):
    db_path = tmp_path / "opencam.json"
    library = ToolLibrary(db_path)
    library.add_material(Material(id="material-6061", name="6061 Aluminum"))
    library.add_tool(
        Tool(
            id="tool-6mm-flat",
            name="6mm flat end mill",
            diameter=6.0,
            flute_length=20.0,
            shoulder_length=30.0,
            tool_number=7,
        )
    )
    library.close()

    reopened = ToolLibrary(db_path)
    try:
        assert reopened.list_materials() == [Material(id="material-6061", name="6061 Aluminum")]
        assert reopened.list_tools() == [
            Tool(
                id="tool-6mm-flat",
                name="6mm flat end mill",
                diameter=6.0,
                flute_length=20.0,
                shoulder_length=30.0,
                tool_number=7,
            )
        ]
    finally:
        reopened.close()


def test_cam_tool_and_material_endpoints_add_and_list_records(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            material_response = client.post(
                "/cam/materials",
                json={"id": "material-walnut", "name": "Walnut"},
            )
            assert material_response.status_code == 201
            assert material_response.json() == {"id": "material-walnut", "name": "Walnut"}

            tool_payload = {
                "id": "tool-manual-1",
                "name": "1/8in flat end mill",
                "diameter": 3.175,
                "fluteLength": 12.7,
                "shoulderLength": 20.0,
                "toolNumber": "manual",
            }
            tool_response = client.post("/cam/tools", json=tool_payload)
            assert tool_response.status_code == 201
            assert tool_response.json() == tool_payload

            assert client.get("/cam/materials").json() == [
                {"id": "material-walnut", "name": "Walnut"}
            ]
            assert client.get("/cam/tools").json() == [tool_payload]
    finally:
        app.dependency_overrides.clear()
        library.close()


def test_cam_tool_endpoint_updates_and_deletes_records(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            tool_payload = {
                "id": "tool-1",
                "name": "6mm flat end mill",
                "diameter": 6.0,
                "fluteLength": 18.0,
                "shoulderLength": 25.0,
                "toolNumber": 1,
            }
            assert client.post("/cam/tools", json=tool_payload).status_code == 201

            updated_tool_payload = {
                **tool_payload,
                "name": "1/4in flat end mill",
                "diameter": 6.35,
                "fluteLength": 20.0,
                "toolNumber": "manual",
            }
            update_response = client.put("/cam/tools/tool-1", json=updated_tool_payload)
            assert update_response.status_code == 200
            assert update_response.json() == updated_tool_payload
            assert client.get("/cam/tools/tool-1").json() == updated_tool_payload

            mismatched_id_response = client.put(
                "/cam/tools/tool-1",
                json={**updated_tool_payload, "id": "other-tool"},
            )
            assert mismatched_id_response.status_code == 400

            assert client.delete("/cam/tools/tool-1").status_code == 204
            assert client.get("/cam/tools/tool-1").status_code == 404
            assert client.delete("/cam/tools/tool-1").status_code == 404
    finally:
        app.dependency_overrides.clear()
        library.close()


def test_cam_tool_endpoint_requires_name(tmp_path):
    library = ToolLibrary(tmp_path / "opencam.json")
    app.dependency_overrides[get_tool_library] = lambda: library

    try:
        with TestClient(app) as client:
            response = client.post(
                "/cam/tools",
                json={
                    "id": "tool-no-name",
                    "diameter": 6.0,
                    "fluteLength": 18.0,
                    "shoulderLength": 25.0,
                    "toolNumber": 1,
                },
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
            duplicate_material_response = client.post("/cam/materials", json=material_payload)
            assert duplicate_material_response.status_code == 409

            tool_payload = {
                "id": "tool-1",
                "name": "6mm flat end mill",
                "diameter": 6.0,
                "fluteLength": 18.0,
                "shoulderLength": 25.0,
                "toolNumber": 1,
            }
            assert client.post("/cam/tools", json=tool_payload).status_code == 201
            duplicate_tool_response = client.post("/cam/tools", json=tool_payload)
            assert duplicate_tool_response.status_code == 409
    finally:
        app.dependency_overrides.clear()
        library.close()
