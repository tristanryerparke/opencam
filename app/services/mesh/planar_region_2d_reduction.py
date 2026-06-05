import numpy as np
import trimesh
from shapely.geometry import Polygon
from trimesh.creation import triangulate_polygon

from app.services.mesh.mesh_reduction import build_planar_regions, ensure_triangle_faces


def plane_basis(normal):
    axis = np.array([0.0, 0.0, 1.0], dtype=np.float64)
    if abs(float(np.dot(axis, normal))) > 0.9:
        axis = np.array([1.0, 0.0, 0.0], dtype=np.float64)
    u = np.cross(normal, axis)
    u /= np.linalg.norm(u)
    v = np.cross(normal, u)
    return u, v


def signed_area(points_2d):
    if len(points_2d) < 3:
        return 0.0
    x = points_2d[:, 0]
    y = points_2d[:, 1]
    return 0.5 * float(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def coord_key(point_2d):
    return (round(float(point_2d[0]), 12), round(float(point_2d[1]), 12))


def extract_boundary_loops(region_faces):
    edge_counts = {}
    for a, b, c in region_faces:
        for u, v in ((int(a), int(b)), (int(b), int(c)), (int(c), int(a))):
            key = (min(u, v), max(u, v))
            edge_counts[key] = edge_counts.get(key, 0) + 1

    boundary_edges = [edge for edge, count in edge_counts.items() if count == 1]
    if not boundary_edges:
        return []

    adjacency = {}
    for u, v in boundary_edges:
        adjacency.setdefault(u, []).append(v)
        adjacency.setdefault(v, []).append(u)

    for neighbors in adjacency.values():
        if len(neighbors) != 2:
            return []

    remaining = set(boundary_edges)
    loops = []
    while remaining:
        start_u, start_v = next(iter(remaining))
        loop = [start_u]
        prev = start_u
        current = start_v

        while True:
            loop.append(current)
            remaining.discard((min(prev, current), max(prev, current)))
            if current == start_u:
                break
            next_candidates = [
                neighbor
                for neighbor in adjacency[current]
                if (min(current, neighbor), max(current, neighbor)) in remaining
            ]
            if len(next_candidates) != 1:
                return []
            prev, current = current, next_candidates[0]

        loops.append(loop[:-1])

    return loops


def project_loop(vertices, loop, origin, basis_u, basis_v):
    loop_vertices = vertices[np.asarray(loop, dtype=np.int64)] - origin
    return np.column_stack((loop_vertices @ basis_u, loop_vertices @ basis_v))


def triangulate_region(vertices, faces, region_face_indices, region_normal):
    region_faces = faces[np.asarray(region_face_indices, dtype=np.int64)]
    loops = extract_boundary_loops(region_faces)
    if not loops:
        return None

    origin = vertices[int(region_faces[0, 0])]
    basis_u, basis_v = plane_basis(region_normal)
    projected_loops = [project_loop(vertices, loop, origin, basis_u, basis_v) for loop in loops]

    outer_index = max(range(len(projected_loops)), key=lambda idx: abs(signed_area(projected_loops[idx])))
    shell_loop = loops[outer_index]
    shell_coords = projected_loops[outer_index]
    hole_loops = [loops[idx] for idx in range(len(loops)) if idx != outer_index]
    hole_coords = [projected_loops[idx] for idx in range(len(projected_loops)) if idx != outer_index]

    polygon = Polygon(shell_coords, holes=hole_coords)
    if polygon.is_empty or not polygon.is_valid or polygon.area <= 1e-12:
        return None

    triangulated_vertices, triangulated_faces = triangulate_polygon(
        polygon,
        engine="earcut",
        force_vertices=True,
    )
    if len(triangulated_faces) == 0:
        return None

    coord_to_vertex = {}
    for loop, coords in [(shell_loop, shell_coords)] + list(zip(hole_loops, hole_coords, strict=False)):
        for vertex_index, coord in zip(loop, coords, strict=False):
            coord_to_vertex[coord_key(coord)] = int(vertex_index)

    face_2d = project_loop(vertices, faces[int(region_face_indices[0])], origin, basis_u, basis_v)
    expected_sign = 1.0 if signed_area(face_2d) >= 0.0 else -1.0

    rebuilt_faces = []
    for face in triangulated_faces:
        tri_coords = triangulated_vertices[np.asarray(face, dtype=np.int64)]
        tri_vertices = []
        for local_index in face:
            key = coord_key(triangulated_vertices[int(local_index)])
            if key not in coord_to_vertex:
                return None
            tri_vertices.append(coord_to_vertex[key])
        if len(set(tri_vertices)) != 3:
            continue
        tri_sign = 1.0 if signed_area(tri_coords) >= 0.0 else -1.0
        if tri_sign != expected_sign:
            tri_vertices[1], tri_vertices[2] = tri_vertices[2], tri_vertices[1]
        rebuilt_faces.append(tri_vertices)

    if not rebuilt_faces:
        return None

    return np.asarray(rebuilt_faces, dtype=np.int64)


def simplify_mesh_data_2d(
    vertices,
    faces,
    max_iterations=None,
    planar_angle_degrees=0.01,
    planar_distance_tol=None,
    verbose=False,
    min_region_faces=3,
    profile=None,
):
    del max_iterations
    del profile

    vertices_array = np.asarray(vertices, dtype=np.float64)
    if vertices_array.ndim != 2 or vertices_array.shape[1] < 3:
        raise ValueError(f"Expected a vertex matrix with at least 3 columns, got {vertices_array.shape}.")

    faces_array = np.asarray(ensure_triangle_faces(faces), dtype=np.int64)
    mesh = trimesh.Trimesh(
        vertices=np.ascontiguousarray(vertices_array[:, :3], dtype=np.float64),
        faces=np.ascontiguousarray(faces_array, dtype=np.int64),
        process=False,
    )

    face_regions, region_normals, _region_offsets, region_sizes, _distance_tol = build_planar_regions(
        mesh,
        normal_tol_degrees=planar_angle_degrees,
        distance_tol=planar_distance_tol,
    )

    kept_faces = []
    rebuilt_faces = []
    replaced_faces = 0
    log = print if verbose else (lambda *args, **kwargs: None)

    for region_id in range(len(region_sizes)):
        region_face_indices = np.flatnonzero(face_regions == region_id)
        if len(region_face_indices) < min_region_faces:
            continue

        rebuilt = triangulate_region(
            mesh.vertices,
            mesh.faces,
            region_face_indices,
            region_normals[region_id],
        )
        if rebuilt is None or len(rebuilt) >= len(region_face_indices):
            continue

        rebuilt_faces.append(rebuilt)
        replaced_faces += len(region_face_indices)
        face_regions[region_face_indices] = -2
        log(
            f"  planar-2d rebuilt region {region_id}: "
            f"{len(region_face_indices)} -> {len(rebuilt)} faces"
        )

    for fi in range(len(mesh.faces)):
        if face_regions[fi] >= 0 or face_regions[fi] == -1:
            kept_faces.append(mesh.faces[fi].copy())

    if rebuilt_faces:
        combined_faces = np.vstack([np.asarray(kept_faces, dtype=np.int64), *rebuilt_faces])
    else:
        combined_faces = np.asarray(kept_faces, dtype=np.int64)

    if replaced_faces == 0 or len(combined_faces) >= len(mesh.faces):
        return mesh

    simplified = trimesh.Trimesh(
        vertices=np.asarray(mesh.vertices, dtype=np.float64).copy(),
        faces=np.asarray(combined_faces, dtype=np.int64),
        process=False,
    )
    simplified.remove_unreferenced_vertices()
    return simplified
