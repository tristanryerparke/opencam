import numpy as np

from opencam.simulation.swept_volume import simplify_planar_mesh


def test_cgal_planar_remesh_reduces_simulation_mesh():
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

    reduced_vertices, reduced_faces = simplify_planar_mesh(vertices, faces)

    assert len(reduced_faces) == 2
    np.testing.assert_allclose(np.min(reduced_vertices, axis=0), [0.0, 0.0, 0.0])
    np.testing.assert_allclose(np.max(reduced_vertices, axis=0), [2.0, 2.0, 0.0])
