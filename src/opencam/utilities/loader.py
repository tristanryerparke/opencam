from pathlib import Path

import gmsh

from opencam.schemas.mesh import Mesh

GMSH_MESH_SIZE_MAX = 3.0


def load_step_mesh(path: Path) -> Mesh:
    gmsh.initialize()
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.model.add(path.stem)
        gmsh.model.occ.importShapes(str(path))
        gmsh.model.occ.synchronize()
        gmsh.option.setNumber("Mesh.MeshSizeMax", GMSH_MESH_SIZE_MAX)
        gmsh.model.mesh.generate(2)

        node_tags, node_coordinates, _ = gmsh.model.mesh.getNodes()
        node_index = {int(tag): index for index, tag in enumerate(node_tags)}
        element_types, _, element_node_tags = gmsh.model.mesh.getElements(2)
        triangle_nodes = [
            nodes
            for element_type, nodes in zip(element_types, element_node_tags)
            if element_type == 2  # three-node triangle
        ]
        if not triangle_nodes:
            raise RuntimeError(f"Gmsh generated no triangles for {path}.")

        vertices = [
            tuple(float(coordinate) for coordinate in node_coordinates[index : index + 3])
            for index in range(0, len(node_coordinates), 3)
        ]
        faces = [
            tuple(node_index[int(nodes[index + offset])] for offset in range(3))
            for nodes in triangle_nodes
            for index in range(0, len(nodes), 3)
        ]
    finally:
        gmsh.finalize()

    # Gmsh imports this STEP file in millimetres; OpenCAM coordinates are millimetres.
    return Mesh(vertices=vertices, faces=faces)
