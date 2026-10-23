from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import gmsh
from opencam_contracts.mesh import Mesh

# ponytail: one Gmsh worker; use worker processes if conversion throughput matters.
_GMSH_EXECUTOR = ThreadPoolExecutor(max_workers=1)


def step_to_mesh(path: Path) -> Mesh:
    return _GMSH_EXECUTOR.submit(_convert_step_to_mesh, path).result()


def _convert_step_to_mesh(path: Path) -> Mesh:
    gmsh.initialize(interruptible=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add(path.stem)
        gmsh.model.occ.importShapes(str(path))
        gmsh.model.occ.synchronize()
        gmsh.option.setNumber("Mesh.MeshSizeMax", 10)          # coarse planar areas
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 100)  # refine curved details
        gmsh.model.mesh.generate(2)

        node_tags, node_coordinates, _ = gmsh.model.mesh.getNodes()
        node_index = {int(tag): index for index, tag in enumerate(node_tags)}
        vertices = [
            tuple(float(coordinate) for coordinate in node_coordinates[index : index + 3])
            for index in range(0, len(node_coordinates), 3)
        ]
        faces: list[tuple[int, int, int]] = []
        source_face_ids: list[int] = []
        for _dimension, surface_tag in gmsh.model.getEntities(2):
            element_types, _, element_node_tags = gmsh.model.mesh.getElements(2, surface_tag)
            for element_type, nodes in zip(element_types, element_node_tags):
                if element_type != 2:  # three-node triangle
                    continue
                for index in range(0, len(nodes), 3):
                    faces.append(
                        tuple(node_index[int(nodes[index + offset])] for offset in range(3))
                    )
                    source_face_ids.append(int(surface_tag))

        if not faces:
            raise RuntimeError(f"Gmsh generated no triangles for {path}.")
    finally:
        gmsh.finalize()

    # Gmsh imports this STEP file in millimetres; OpenCAM coordinates are millimetres.
    return Mesh(vertices=vertices, faces=faces, source_face_ids=source_face_ids)
