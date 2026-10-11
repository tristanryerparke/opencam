from pathlib import Path

from fastapi.testclient import TestClient

from opencam.services.mesh_cache import MeshCache
from server import main as server_main

STEP_PATH = Path(__file__).parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"


def test_cam_mesh_cache_uploads_step_and_serves_backend_mesh(tmp_path, monkeypatch):
    cache = MeshCache(tmp_path)
    monkeypatch.setattr(server_main, "get_mesh_cache", lambda: cache)
    step_bytes = STEP_PATH.read_bytes()

    with TestClient(server_main.app) as client:
        assert client.get("/cam/mesh").status_code == 404

        upload = client.post(
            "/cam/mesh",
            files={"step": (STEP_PATH.name, step_bytes, "application/step")},
        )
        assert upload.status_code == 201
        payload = upload.json()
        assert payload["name"] == STEP_PATH.name
        assert payload["meshUrl"].startswith("/cam/mesh/file?v=")
        assert payload["maxZ"] > 0

        record = cache.get_mesh()
        assert record is not None
        assert record.version == payload["version"]
        assert record.step_bytes == step_bytes
        assert len(record.mesh.source_face_ids or []) == len(record.mesh.faces)

        restored = MeshCache(tmp_path)
        assert restored.get_metadata() == cache.get_metadata()
        assert restored.get_mesh() is not None
        assert restored.get_mesh().step_bytes == step_bytes
        monkeypatch.setattr(server_main, "get_mesh_cache", lambda: restored)
        assert server_main.server_cached_mesh_loader(payload["version"]) is not None
        assert server_main.server_cached_mesh_loader("stale") is None
        assert client.get("/cam/mesh/file?v=stale").status_code == 404
        monkeypatch.setattr(server_main, "get_mesh_cache", lambda: cache)
        mesh_file = client.get(payload["meshUrl"])
        assert mesh_file.status_code == 200
        mesh_payload = mesh_file.json()
        assert len(mesh_payload["vertices"]) == len(record.mesh.vertices)
        assert len(mesh_payload["faces"]) == len(record.mesh.faces)
        assert len(mesh_payload["sourceFaceIds"]) == len(record.mesh.faces)

        replacement = client.post(
            "/cam/mesh",
            files={"step": ("replacement.step", step_bytes, "application/step")},
        )
        assert replacement.status_code == 201
        assert replacement.json()["version"] != payload["version"]
        assert client.get(payload["meshUrl"]).status_code == 404
        assert MeshCache(tmp_path).get_metadata().name == "replacement.step"
        assert len(list(tmp_path.iterdir())) == 1

        assert client.delete("/cam/mesh").status_code == 204
        assert client.get("/cam/mesh").status_code == 404
        assert MeshCache(tmp_path).get_mesh() is None
