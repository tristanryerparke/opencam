import numpy as np

from opencam._cgal_planar import remesh_planar_patches
from opencam.services.mesh.planar_region_2d_reduction import simplify_mesh_data_2d


def test_cgal_planar_remesh_matches_current_simple_plane():
    vertices = np.array(
        [
            [0.0, 0.0, 0.0],
            [1.0, 0.0, 0.0],
            [2.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [1.0, 1.0, 0.0],
            [2.0, 1.0, 0.0],
            [0.0, 2.0, 0.0],
            [1.0, 2.0, 0.0],
            [2.0, 2.0, 0.0],
        ],
        dtype=np.float64,
    )
    faces = np.array(
        [
            [0, 1, 4],
            [0, 4, 3],
            [1, 2, 5],
            [1, 5, 4],
            [3, 4, 7],
            [3, 7, 6],
            [4, 5, 8],
            [4, 8, 7],
        ],
        dtype=np.int64,
    )

    current = simplify_mesh_data_2d(vertices, faces)
    cgal_vertices, cgal_faces = remesh_planar_patches(vertices, faces)

    assert len(current.faces) == 6
    assert len(cgal_faces) == 2
    assert len(cgal_faces) < len(current.faces)
    np.testing.assert_allclose(np.min(current.vertices, axis=0), [0.0, 0.0, 0.0])
    np.testing.assert_allclose(np.max(current.vertices, axis=0), [2.0, 2.0, 0.0])
    np.testing.assert_allclose(np.min(cgal_vertices, axis=0), [0.0, 0.0, 0.0])
    np.testing.assert_allclose(np.max(cgal_vertices, axis=0), [2.0, 2.0, 0.0])
