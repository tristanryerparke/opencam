from pathlib import Path

from fastapi.testclient import TestClient

from opencam.services.mesh_cache import get_mesh_cache
from server.main import app

STEP_PATH = Path(__file__).parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"


def test_cam_mesh_cache_uploads_step_and_serves_backend_mesh():
    cache = get_mesh_cache()
    cache.clear()
    step_bytes = STEP_PATH.read_bytes()

    try:
        with TestClient(app) as client:
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

            mesh_file = client.get("/cam/mesh/file")
            assert mesh_file.status_code == 200
            mesh_payload = mesh_file.json()
            assert len(mesh_payload["vertices"]) == len(record.mesh.vertices)
            assert len(mesh_payload["faces"]) == len(record.mesh.faces)
            assert len(mesh_payload["sourceFaceIds"]) == len(record.mesh.faces)

            assert client.delete("/cam/mesh").status_code == 204
            assert client.get("/cam/mesh").status_code == 404
    finally:
        cache.clear()
