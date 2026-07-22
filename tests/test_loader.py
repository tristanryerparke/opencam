from pathlib import Path

from opencam.utilities.loader import step_to_mesh


def test_step_to_mesh_preserves_source_surface_ids():
    mesh = step_to_mesh(
        Path(__file__).parents[1] / "assets/operations/parallel-finishing/Parallel_Finishing_C.stp"
    )

    assert mesh.source_face_ids is not None
    assert len(mesh.source_face_ids) == len(mesh.faces)
    assert len(set(mesh.source_face_ids)) > 1
