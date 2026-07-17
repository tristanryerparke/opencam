from fastapi.testclient import TestClient

from opencam.services.mesh_cache import get_mesh_cache
from server.main import app

ASCII_STL = b"""solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 2
  endloop
endfacet
endsolid test
"""


def test_cam_mesh_cache_upload_get_and_clear():
    cache = get_mesh_cache()
    cache.clear()

    try:
        with TestClient(app) as client:
            assert client.get("/cam/mesh").status_code == 404

            upload = client.post(
                "/cam/mesh",
                files={"mesh": ("test.stl", ASCII_STL, "model/stl")},
            )
            assert upload.status_code == 201
            payload = upload.json()
            assert payload["name"] == "test.stl"
            assert payload["meshUrl"].startswith("/cam/mesh/file?v=")
            assert payload["maxZ"] == 2.0

            assert client.get("/cam/mesh").json() == payload

            mesh_file = client.get("/cam/mesh/file")
            assert mesh_file.status_code == 200
            assert mesh_file.content == ASCII_STL

            assert client.delete("/cam/mesh").status_code == 204
            assert client.get("/cam/mesh").status_code == 404
    finally:
        cache.clear()
