"""Reusable planar mesh reduction utilities based on Quadric Error Metrics (QEM).

The main entry point is :func:`simplify_mesh`, which accepts a
``trimesh.Trimesh`` and returns a simplified mesh. Use
:func:`simplify_mesh_data` for raw vertex / face arrays. Lower-level helpers
are also available for callers that need finer-grained control.
"""

import time
from dataclasses import dataclass

import numpy as np
import trimesh
from numba import njit
from heapq import heappush, heappop


def ensure_triangle_faces(faces):
    """Validate and coerce a face array to triangular integer faces."""
    face_array = np.asarray(faces, dtype=np.int64)
    if face_array.ndim != 2 or face_array.shape[1] != 3:
        raise ValueError(f"Expected a triangular face array of shape (m, 3), got {face_array.shape}.")
    return face_array


@dataclass
class QEMProfile:
    build_planar_regions_seconds: float = 0.0
    region_constraints_seconds: float = 0.0
    compute_quadrics_seconds: float = 0.0
    initial_edge_build_seconds: float = 0.0
    initial_batch_cost_seconds: float = 0.0
    heap_seed_seconds: float = 0.0
    loop_seconds: float = 0.0
    heap_pop_seconds: float = 0.0
    region_check_seconds: float = 0.0
    projection_seconds: float = 0.0
    check_collapse_seconds: float = 0.0
    disconnect_seconds: float = 0.0
    collapse_update_seconds: float = 0.0
    shared_faces_seconds: float = 0.0
    reassign_seconds: float = 0.0
    neighbor_search_seconds: float = 0.0
    stale_cleanup_seconds: float = 0.0
    recompute_edge_seconds: float = 0.0
    build_mesh_seconds: float = 0.0
    split_seconds: float = 0.0
    total_seconds: float = 0.0

    original_vertices: int = 0
    original_faces: int = 0
    final_vertices: int = 0
    final_faces: int = 0
    region_count: int = 0
    eligible_regions: int = 0
    initial_edges: int = 0
    heap_seeded_edges: int = 0
    heap_pops: int = 0
    accepted_collapses: int = 0
    rejected_dead_vertices: int = 0
    rejected_missing_edge: int = 0
    rejected_cost_mismatch: int = 0
    rejected_region: int = 0
    rejected_check_collapse: int = 0
    rejected_disconnect: int = 0
    shared_faces_removed: int = 0
    reassign_updates: int = 0
    neighbor_vertices: int = 0
    stale_cleanup_scans: int = 0
    stale_edges_removed: int = 0
    recomputed_edges: int = 0


def format_qem_profile(profile: QEMProfile, *, indent: str = "  ") -> str:
    """Format a detailed QEM timing profile for human-readable logs."""
    lines = [f"{indent}QEM profile:"]
    lines.append(f"{indent}  setup:")
    lines.append(f"{indent}    planar regions:      {profile.build_planar_regions_seconds:.3f}s")
    lines.append(f"{indent}    region constraints:   {profile.region_constraints_seconds:.3f}s")
    lines.append(f"{indent}    quadrics:             {profile.compute_quadrics_seconds:.3f}s")
    lines.append(f"{indent}    initial edge build:   {profile.initial_edge_build_seconds:.3f}s")
    lines.append(f"{indent}    initial batch costs:   {profile.initial_batch_cost_seconds:.3f}s")
    lines.append(f"{indent}    heap seeding:         {profile.heap_seed_seconds:.3f}s")
    lines.append(f"{indent}    initial edges:        {profile.initial_edges}")
    lines.append(f"{indent}    heap seeded edges:    {profile.heap_seeded_edges}")
    lines.append(f"{indent}  loop: {profile.loop_seconds:.3f}s")
    lines.append(f"{indent}    heap pops:            {profile.heap_pops}")
    lines.append(f"{indent}    accepted collapses:   {profile.accepted_collapses}")
    lines.append(
        f"{indent}    rejects: dead {profile.rejected_dead_vertices}, "
        f"missing edge {profile.rejected_missing_edge}, "
        f"cost mismatch {profile.rejected_cost_mismatch}, region {profile.rejected_region}, "
        f"topology {profile.rejected_check_collapse}, disconnect {profile.rejected_disconnect}"
    )
    lines.append(f"{indent}    timings:")
    lines.append(f"{indent}      heap pop:           {profile.heap_pop_seconds:.3f}s")
    lines.append(f"{indent}      region check:       {profile.region_check_seconds:.3f}s")
    lines.append(f"{indent}      projection:         {profile.projection_seconds:.3f}s")
    lines.append(f"{indent}      check_collapse:     {profile.check_collapse_seconds:.3f}s")
    lines.append(f"{indent}      would_disconnect:   {profile.disconnect_seconds:.3f}s")
    lines.append(f"{indent}      collapse update:    {profile.collapse_update_seconds:.3f}s")
    lines.append(f"{indent}      shared faces:       {profile.shared_faces_seconds:.3f}s")
    lines.append(f"{indent}      reassign:           {profile.reassign_seconds:.3f}s")
    lines.append(f"{indent}      neighbor search:    {profile.neighbor_search_seconds:.3f}s")
    lines.append(f"{indent}      stale cleanup:      {profile.stale_cleanup_seconds:.3f}s")
    lines.append(f"{indent}      recompute edges:    {profile.recompute_edge_seconds:.3f}s")
    lines.append(f"{indent}      stale scans:        {profile.stale_cleanup_scans}")
    lines.append(f"{indent}      stale edges removed:{profile.stale_edges_removed}")
    lines.append(f"{indent}      neighbor verts:     {profile.neighbor_vertices}")
    lines.append(f"{indent}      shared faces removed:{profile.shared_faces_removed}")
    lines.append(f"{indent}      reassign updates:   {profile.reassign_updates}")
    lines.append(f"{indent}      recomputed edges:   {profile.recomputed_edges}")
    lines.append(f"{indent}  mesh build: {profile.build_mesh_seconds:.3f}s")
    lines.append(f"{indent}  split:      {profile.split_seconds:.3f}s")
    lines.append(f"{indent}  total:      {profile.total_seconds:.3f}s")
    if profile.original_faces or profile.final_faces:
        lines.append(
            f"{indent}  faces:      {profile.original_faces} -> {profile.final_faces}, "
            f"verts {profile.original_vertices} -> {profile.final_vertices}"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# JIT-compiled kernels
# ---------------------------------------------------------------------------

@njit(cache=True)
def compute_quadrics_jit(vertices, faces):
    """Compute per-vertex accumulated quadric matrices (n_verts, 4, 4)."""
    n_verts = vertices.shape[0]
    n_faces = faces.shape[0]
    Q = np.zeros((n_verts, 4, 4))
    for fi in range(n_faces):
        i0 = faces[fi, 0]; i1 = faces[fi, 1]; i2 = faces[fi, 2]
        v0 = vertices[i0]; v1 = vertices[i1]; v2 = vertices[i2]
        e1 = v1 - v0; e2 = v2 - v0
        nx = e1[1]*e2[2] - e1[2]*e2[1]
        ny = e1[2]*e2[0] - e1[0]*e2[2]
        nz = e1[0]*e2[1] - e1[1]*e2[0]
        length = np.sqrt(nx*nx + ny*ny + nz*nz)
        if length < 1e-12:
            continue
        nx /= length; ny /= length; nz /= length
        d = -(nx*v0[0] + ny*v0[1] + nz*v0[2])
        p = np.array([nx, ny, nz, d])
        Kp = np.outer(p, p)
        Q[i0] += Kp; Q[i1] += Kp; Q[i2] += Kp
    return Q


@njit(cache=True)
def solve_position_4x4(Q_sum):
    """Solve (Q1+Q2) for optimal collapse position. Returns (success, x,y,z)."""
    A = Q_sum.copy()
    A[3, 0] = 0.0; A[3, 1] = 0.0; A[3, 2] = 0.0; A[3, 3] = 1.0
    aug = np.empty((4, 5))
    aug[:4, :4] = A
    aug[0, 4] = 0.0; aug[1, 4] = 0.0; aug[2, 4] = 0.0; aug[3, 4] = 1.0
    for col in range(4):
        max_val = np.abs(aug[col, col]); max_row = col
        for row in range(col + 1, 4):
            val = np.abs(aug[row, col])
            if val > max_val: max_val = val; max_row = row
        if max_val < 1e-12:
            return False, 0.0, 0.0, 0.0
        if max_row != col:
            for j in range(5):
                tmp = aug[col, j]; aug[col, j] = aug[max_row, j]; aug[max_row, j] = tmp
        pivot = aug[col, col]
        for j in range(col, 5): aug[col, j] /= pivot
        for row in range(4):
            if row == col: continue
            factor = aug[row, col]
            if abs(factor) > 1e-15:
                for j in range(col, 5): aug[row, j] -= factor * aug[col, j]
    w = aug[3, 4]
    if abs(w) < 1e-10 or not np.isfinite(w):
        return False, 0.0, 0.0, 0.0
    return True, aug[0,4]/w, aug[1,4]/w, aug[2,4]/w


@njit(cache=True)
def quadric_cost(Q_sum, pos):
    """Quadric error v^T Q v for pos=[x,y,z]."""
    x = pos[0]; y = pos[1]; z = pos[2]
    r0 = Q_sum[0,0]*x + Q_sum[0,1]*y + Q_sum[0,2]*z + Q_sum[0,3]
    r1 = Q_sum[1,0]*x + Q_sum[1,1]*y + Q_sum[1,2]*z + Q_sum[1,3]
    r2 = Q_sum[2,0]*x + Q_sum[2,1]*y + Q_sum[2,2]*z + Q_sum[2,3]
    r3 = Q_sum[3,0]*x + Q_sum[3,1]*y + Q_sum[3,2]*z + Q_sum[3,3]
    return x*r0 + y*r1 + z*r2 + r3


@njit(cache=True)
def compute_edge_cost(Q1, Q2, v1, v2):
    """Compute (cost, x, y, z) for collapsing v1-v2."""
    Q_sum = Q1 + Q2
    ok, x, y, z = solve_position_4x4(Q_sum)
    if not ok:
        best_cost = np.inf
        bx = (v1[0]+v2[0])*0.5; by = (v1[1]+v2[1])*0.5; bz = (v1[2]+v2[2])*0.5
        for trial in range(3):
            if trial == 0: p = np.array([(v1[0]+v2[0])*0.5, (v1[1]+v2[1])*0.5, (v1[2]+v2[2])*0.5])
            elif trial == 1: p = v1
            else: p = v2
            c = quadric_cost(Q_sum, p)
            if c < best_cost: best_cost = c; bx = p[0]; by = p[1]; bz = p[2]
        return best_cost, bx, by, bz
    pos = np.array([x, y, z])
    cost = quadric_cost(Q_sum, pos)
    return cost, x, y, z


@njit(cache=True)
def batch_compute_edge_costs(Q, edges, vertices):
    """Compute costs and positions for a batch of edges."""
    n = edges.shape[0]
    costs = np.empty(n)
    positions = np.empty((n, 3))
    for i in range(n):
        v0 = edges[i, 0]; v1 = edges[i, 1]
        cost, x, y, z = compute_edge_cost(Q[v0], Q[v1], vertices[v0], vertices[v1])
        costs[i] = cost; positions[i, 0] = x; positions[i, 1] = y; positions[i, 2] = z
    return costs, positions


@njit(cache=True)
def find_shared_faces(v0, v1, faces, face_alive, n_faces):
    """Return array of face indices that contain both v0 and v1."""
    result = np.empty(n_faces, dtype=np.int64)
    count = 0
    for fi in range(n_faces):
        if not face_alive[fi]: continue
        has_v0 = (faces[fi,0] == v0 or faces[fi,1] == v0 or faces[fi,2] == v0)
        if not has_v0: continue
        has_v1 = (faces[fi,0] == v1 or faces[fi,1] == v1 or faces[fi,2] == v1)
        if has_v1:
            result[count] = fi; count += 1
    return result[:count]


@njit(cache=True)
def reassign_v1_to_v0(v0, v1, faces, face_alive, n_faces):
    """
    Reassign v1->v0 in v1's remaining non-shared faces.
    Returns (affected_verts_array, affected_count).
    Also returns which faces were actually modified.
    """
    affected = np.empty(n_faces, dtype=np.int64)  # vertex indices
    aff_count = 0
    for fi in range(n_faces):
        if not face_alive[fi]: continue
        has_v1 = (faces[fi,0] == v1 or faces[fi,1] == v1 or faces[fi,2] == v1)
        if not has_v1: continue
        has_v0 = (faces[fi,0] == v0 or faces[fi,1] == v0 or faces[fi,2] == v0)
        if has_v0: continue  # shared — already handled
        for j in range(3):
            if faces[fi, j] == v1:
                faces[fi, j] = v0
            elif faces[fi, j] != v0:
                affected[aff_count] = faces[fi, j]; aff_count += 1
    return affected[:aff_count]


@njit(cache=True)
def check_collapse_jit(v0, v1, v_new, vertices, faces, face_alive):
    """Check if collapsing v0-v1 to v_new preserves mesh validity."""
    n_faces = faces.shape[0]
    for fi in range(n_faces):
        if not face_alive[fi]: continue
        has_v1 = (faces[fi,0] == v1 or faces[fi,1] == v1 or faces[fi,2] == v1)
        if not has_v1: continue
        has_v0 = (faces[fi,0] == v0 or faces[fi,1] == v0 or faces[fi,2] == v0)
        if has_v0: continue
        a = faces[fi,0]; b = faces[fi,1]; c = faces[fi,2]
        pa = v_new if a == v1 else vertices[a]
        pb = v_new if b == v1 else vertices[b]
        pc = v_new if c == v1 else vertices[c]
        e1x = pb[0]-pa[0]; e1y = pb[1]-pa[1]; e1z = pb[2]-pa[2]
        e2x = pc[0]-pa[0]; e2y = pc[1]-pa[1]; e2z = pc[2]-pa[2]
        cx = e1y*e2z - e1z*e2y
        cy = e1z*e2x - e1x*e2z
        cz = e1x*e2y - e1y*e2x
        if cx*cx + cy*cy + cz*cz < 1e-28:
            return False
    return True


@njit(cache=True)
def count_faces_of_edge(v0, v1, faces, face_alive):
    """Count how many alive faces contain edge (v0, v1)."""
    count = 0
    n_faces = faces.shape[0]
    for fi in range(n_faces):
        if not face_alive[fi]:
            continue
        has_v0 = (faces[fi, 0] == v0 or faces[fi, 1] == v0 or faces[fi, 2] == v0)
        if not has_v0:
            continue
        has_v1 = (faces[fi, 0] == v1 or faces[fi, 1] == v1 or faces[fi, 2] == v1)
        if has_v1:
            count += 1
    return count


@njit(cache=True)
def is_boundary_edge(vi, faces, face_alive):
    """Check if vertex vi has any boundary edge (edge with only 1 adjacent face)."""
    n_faces = faces.shape[0]
    for fi in range(n_faces):
        if not face_alive[fi]:
            continue
        has_vi = (faces[fi, 0] == vi or faces[fi, 1] == vi or faces[fi, 2] == vi)
        if not has_vi:
            continue
        a = faces[fi, 0]
        b = faces[fi, 1]
        c = faces[fi, 2]
        # Check each edge of this face that includes vi
        if a == vi:
            mate = b
        elif b == vi:
            mate = a
        else:
            mate = a
        # Count faces sharing edge (vi, first_mate)
        cnt = 0
        for fj in range(n_faces):
            if not face_alive[fj]:
                continue
            if (faces[fj, 0] == vi or faces[fj, 1] == vi or faces[fj, 2] == vi) and \
               (faces[fj, 0] == mate or faces[fj, 1] == mate or faces[fj, 2] == mate):
                cnt += 1
        if cnt == 1:
            return True
    return False


@njit(cache=True)
def would_disconnect(v0, v1, faces, face_alive):
    """
    Check if collapsing v0-v1 would disconnect the mesh.
    After collapse, shared faces (containing both v0,v1) are removed,
    and v1's other faces are rewired to v0.
    We check: among v1's neighbors (excluding v0), would any pair lose
    their connection through v1?
    
    Specifically: for each pair of v1's one-ring neighbors (a, b),
    check if they share a face NOT containing v1. If not, and they
    also don't connect through v0, collapsing disconnects them.
    """
    n_faces = faces.shape[0]
    n_verts_max = faces.max() + 1
    
    # Gather v1's alive neighbor vertices (excluding v0)
    v1_neighbors = np.empty(n_verts_max, dtype=np.int64)
    v1_nb_count = 0
    for fi in range(n_faces):
        if not face_alive[fi]:
            continue
        has_v1 = (faces[fi, 0] == v1 or faces[fi, 1] == v1 or faces[fi, 2] == v1)
        if not has_v1:
            continue
        for j in range(3):
            vi = faces[fi, j]
            if vi != v1 and vi != v0:
                # Check not already in list
                already = False
                for k in range(v1_nb_count):
                    if v1_neighbors[k] == vi:
                        already = True
                        break
                if not already:
                    v1_neighbors[v1_nb_count] = vi
                    v1_nb_count += 1
    
    if v1_nb_count <= 1:
        return False
    
    # For each neighbor, collect which OTHER v1-neighbors it connects to
    # through faces that DON'T contain v1 (or through v0 after collapse)
    # If any v1-neighbor is only connected to others via v1, disconnect happens
    
    # Simple approach: for each v1-neighbor, check if it shares a face
    # with v0 (post-collapse it will connect through v0)
    connects_through_v0 = np.zeros(v1_nb_count, dtype=np.bool_)
    for idx in range(v1_nb_count):
        nb = v1_neighbors[idx]
        found = False
        for fi in range(n_faces):
            if not face_alive[fi]:
                continue
            has_nb = (faces[fi, 0] == nb or faces[fi, 1] == nb or faces[fi, 2] == nb)
            if not has_nb:
                continue
            has_v0 = (faces[fi, 0] == v0 or faces[fi, 1] == v0 or faces[fi, 2] == v0)
            if has_v0:
                found = True
                break
        connects_through_v0[idx] = found
    
    # If all neighbors connect through v0, no disconnect
    all_through_v0 = True
    for idx in range(v1_nb_count):
        if not connects_through_v0[idx]:
            all_through_v0 = False
            break
    if all_through_v0:
        return False
    
    # Check if non-v0-connected neighbors connect to each other
    # without going through v1
    for i in range(v1_nb_count):
        if connects_through_v0[i]:
            continue
        nb_i = v1_neighbors[i]
        connected = False
        for fi in range(n_faces):
            if not face_alive[fi]:
                continue
            has_nb_i = (faces[fi, 0] == nb_i or faces[fi, 1] == nb_i or faces[fi, 2] == nb_i)
            if not has_nb_i:
                continue
            has_v1_here = (faces[fi, 0] == v1 or faces[fi, 1] == v1 or faces[fi, 2] == v1)
            if has_v1_here:
                continue
            for j_nb in range(v1_nb_count):
                if j_nb == i:
                    continue
                nb_j = v1_neighbors[j_nb]
                if (faces[fi, 0] == nb_j or faces[fi, 1] == nb_j or faces[fi, 2] == nb_j):
                    connected = True
                    break
            if connected:
                break
        if not connected:
            return True
    
    return False


@njit(cache=True)
def find_neighbor_verts(v0, vert_alive, faces, face_alive):
    """Find alive neighbor vertices of v0 across alive faces."""
    n_faces = faces.shape[0]
    n_verts = vert_alive.shape[0]
    seen = np.zeros(n_verts, dtype=np.bool_)
    count = 0
    neighbors = np.empty(n_verts, dtype=np.int64)
    for fi in range(n_faces):
        if not face_alive[fi]: continue
        has_v0 = (faces[fi,0] == v0 or faces[fi,1] == v0 or faces[fi,2] == v0)
        if not has_v0: continue
        for j in range(3):
            vi = faces[fi, j]
            if vi != v0 and vert_alive[vi] and not seen[vi]:
                seen[vi] = True; neighbors[count] = vi; count += 1
    return neighbors[:count]


def canonicalize_plane(normal, offset):
    """Flip plane sign to a canonical orientation for stable comparisons."""
    nx, ny, nz = normal
    if (
        nx < 0.0
        or (abs(nx) < 1e-12 and ny < 0.0)
        or (abs(nx) < 1e-12 and abs(ny) < 1e-12 and nz < 0.0)
    ):
        return -normal, -offset
    return normal, offset


def compute_face_planes(vertices, faces):
    """Compute canonical unit plane equations for each face."""
    n_faces = len(faces)
    normals = np.zeros((n_faces, 3), dtype=np.float64)
    offsets = np.zeros(n_faces, dtype=np.float64)
    valid = np.zeros(n_faces, dtype=np.bool_)

    for fi in range(n_faces):
        i0, i1, i2 = faces[fi]
        v0 = vertices[i0]
        v1 = vertices[i1]
        v2 = vertices[i2]
        normal = np.cross(v1 - v0, v2 - v0)
        length = np.linalg.norm(normal)
        if length < 1e-12:
            continue
        normal /= length
        offset = -float(np.dot(normal, v0))
        normal, offset = canonicalize_plane(normal, offset)
        normals[fi] = normal
        offsets[fi] = offset
        valid[fi] = True

    return normals, offsets, valid


def build_planar_regions(mesh, normal_tol_degrees=0.01, distance_tol=None):
    """Cluster adjacent faces into planar regions using normal + plane distance."""
    vertices = np.asarray(mesh.vertices, dtype=np.float64)
    faces = np.asarray(mesh.faces, dtype=np.int64)
    normals, offsets, valid = compute_face_planes(vertices, faces)
    n_faces = len(faces)

    if distance_tol is None:
        bbox_diag = float(np.linalg.norm(mesh.bounds[1] - mesh.bounds[0]))
        distance_tol = max(1e-6, bbox_diag * 1e-5)

    cos_tol = float(np.cos(np.deg2rad(normal_tol_degrees)))
    adjacency = [[] for _ in range(n_faces)]
    for fi, fj in np.asarray(mesh.face_adjacency, dtype=np.int64):
        fi = int(fi)
        fj = int(fj)
        adjacency[fi].append(fj)
        adjacency[fj].append(fi)

    face_regions = np.full(n_faces, -1, dtype=np.int64)
    region_normals = []
    region_offsets = []
    region_sizes = []
    region_id = 0

    for start in range(n_faces):
        if face_regions[start] != -1 or not valid[start]:
            continue

        seed_normal = normals[start]
        seed_offset = offsets[start]
        stack = [start]
        face_regions[start] = region_id
        faces_in_region = []

        while stack:
            fi = stack.pop()
            faces_in_region.append(fi)
            for fj in adjacency[fi]:
                if face_regions[fj] != -1 or not valid[fj]:
                    continue
                if np.dot(seed_normal, normals[fj]) < cos_tol:
                    continue
                if abs(seed_offset - offsets[fj]) > distance_tol:
                    continue
                face_regions[fj] = region_id
                stack.append(fj)

        region_normal = normals[faces_in_region].mean(axis=0)
        region_normal /= np.linalg.norm(region_normal)
        region_offset = float(offsets[faces_in_region].mean())
        region_normal, region_offset = canonicalize_plane(region_normal, region_offset)

        region_normals.append(region_normal)
        region_offsets.append(region_offset)
        region_sizes.append(len(faces_in_region))
        region_id += 1

    return (
        face_regions,
        np.asarray(region_normals, dtype=np.float64),
        np.asarray(region_offsets, dtype=np.float64),
        np.asarray(region_sizes, dtype=np.int64),
        float(distance_tol),
    )


def compute_region_vertex_constraints(faces, face_regions, n_verts, region_sizes=None, min_region_faces=3):
    """
    Mark region boundary/feature vertices as locked.

    Only vertices strictly inside a single planar region that meets the
    minimum face-count threshold are left collapsible.

    If ``region_sizes`` is omitted, all regions are treated as active for
    backward compatibility.
    """
    incident_regions = [set() for _ in range(n_verts)]
    edge_counts = {}
    edge_region = {}
    mixed_region_edges = set()
    if region_sizes is None:
        max_region_id = int(face_regions.max()) if len(face_regions) > 0 else -1
        region_is_active = np.ones(max_region_id + 1, dtype=np.bool_)
    else:
        region_is_active = np.asarray(region_sizes, dtype=np.int64) >= min_region_faces

    for fi in range(len(faces)):
        region_id = int(face_regions[fi])
        a, b, c = (int(faces[fi, 0]), int(faces[fi, 1]), int(faces[fi, 2]))

        incident_regions[a].add(region_id)
        incident_regions[b].add(region_id)
        incident_regions[c].add(region_id)

        for u, v in ((a, b), (b, c), (c, a)):
            key = (min(u, v), max(u, v))
            if key in edge_counts:
                edge_counts[key] += 1
                if edge_region[key] != region_id:
                    mixed_region_edges.add(key)
            else:
                edge_counts[key] = 1
                edge_region[key] = region_id

    vertex_locked = np.zeros(n_verts, dtype=np.bool_)
    vertex_regions = np.full(n_verts, -1, dtype=np.int64)

    for (u, v), count in edge_counts.items():
        if count != 2 or (u, v) in mixed_region_edges:
            vertex_locked[u] = True
            vertex_locked[v] = True

    for vi in range(n_verts):
        regions = incident_regions[vi]
        if len(regions) != 1 or -1 in regions:
            vertex_locked[vi] = True
            continue

        region_id = next(iter(regions))
        if region_id < 0 or region_id >= len(region_is_active) or not region_is_active[region_id]:
            vertex_locked[vi] = True
            continue

        if not vertex_locked[vi]:
            vertex_regions[vi] = region_id

    return vertex_regions, vertex_locked


def project_point_to_plane(point, normal, offset):
    """Project a point onto plane normal·x + offset = 0."""
    return point - (np.dot(normal, point) + offset) * normal


def can_collapse_in_region(v0, v1, vertex_regions, vertex_locked):
    """Allow collapses only between unlocked vertices in the same planar region."""
    if vertex_locked[v0] or vertex_locked[v1]:
        return False
    region_id = int(vertex_regions[v0])
    return region_id != -1 and region_id == int(vertex_regions[v1])


# ---------------------------------------------------------------------------
# Main simplification loop
# ---------------------------------------------------------------------------

def qem_simplify(
    mesh,
    max_iterations=None,
    planar_angle_degrees=0.01,
    planar_distance_tol=None,
    verbose=False,
    min_region_faces=3,
    profile=None,
):
    vertices = mesh.vertices.copy().astype(np.float64)
    faces = mesh.faces.copy().astype(np.int64)
    n_verts = len(vertices)
    n_faces = len(faces)
    original_faces = n_faces
    log = print if verbose else (lambda *args, **kwargs: None)
    profile_enabled = profile is not None
    now = time.perf_counter
    total_start = now() if profile_enabled else 0.0

    if min_region_faces < 0:
        raise ValueError(f"Minimum planar region size must be non-negative, got {min_region_faces}.")

    if profile_enabled:
        profile.original_vertices = n_verts
        profile.original_faces = original_faces

    if n_faces == 0:
        log("  Simplification skipped because the mesh has no faces.")
        simplified = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
        if profile_enabled:
            profile.final_vertices = n_verts
            profile.final_faces = 0
            profile.total_seconds += now() - total_start
        return simplified

    if max_iterations is None:
        log(f"Starting QEM simplification: {original_faces} faces (until no valid collapses remain)")
    else:
        log(f"Starting QEM simplification: {original_faces} faces (max {max_iterations} collapses)")

    if profile_enabled:
        phase_start = now()
    face_regions, region_normals, region_offsets, region_sizes, planar_distance_tol = build_planar_regions(
        mesh,
        normal_tol_degrees=planar_angle_degrees,
        distance_tol=planar_distance_tol,
    )
    if profile_enabled:
        profile.build_planar_regions_seconds += now() - phase_start
        profile.region_count = len(region_sizes)

    if profile_enabled:
        phase_start = now()
    vertex_regions, vertex_locked = compute_region_vertex_constraints(
        faces,
        face_regions,
        n_verts,
        region_sizes=region_sizes,
        min_region_faces=min_region_faces,
    )
    if profile_enabled:
        profile.region_constraints_seconds += now() - phase_start
    collapsible_vertices = int(np.count_nonzero(vertex_regions != -1))
    eligible_regions = int(np.count_nonzero(region_sizes >= min_region_faces))
    if profile_enabled:
        profile.eligible_regions = eligible_regions
    log(
        f"  Detected {len(region_sizes)} planar regions "
        f"({eligible_regions} eligible, min {min_region_faces} face(s), "
        f"angle tol {planar_angle_degrees:.2f}°, distance tol {planar_distance_tol:.6g})"
    )
    log(f"  Collapsible interior vertices: {collapsible_vertices} / {n_verts}")

    if profile_enabled:
        phase_start = now()
    Q = compute_quadrics_jit(vertices, faces)
    if profile_enabled:
        profile.compute_quadrics_seconds += now() - phase_start

    face_alive = np.ones(n_faces, dtype=np.bool_)
    vert_alive = np.ones(n_verts, dtype=np.bool_)

    # Build initial edge set from collapsible interior edges only.
    if profile_enabled:
        phase_start = now()
    edge_set = set()
    for fi in range(n_faces):
        a, b, c = int(faces[fi, 0]), int(faces[fi, 1]), int(faces[fi, 2])
        for u, v in ((a, b), (b, c), (a, c)):
            ekey = (min(u, v), max(u, v))
            if can_collapse_in_region(ekey[0], ekey[1], vertex_regions, vertex_locked):
                edge_set.add(ekey)
    edges_arr = np.array(sorted(edge_set), dtype=np.int64).reshape((-1, 2))
    if profile_enabled:
        profile.initial_edge_build_seconds += now() - phase_start
        profile.initial_edges = len(edges_arr)

    # Batch compute initial costs.
    if profile_enabled:
        phase_start = now()
    if len(edges_arr) > 0:
        init_costs, init_positions = batch_compute_edge_costs(Q, edges_arr, vertices)
    else:
        init_costs = np.empty(0, dtype=np.float64)
        init_positions = np.empty((0, 3), dtype=np.float64)
    if profile_enabled:
        profile.initial_batch_cost_seconds += now() - phase_start

    if profile_enabled:
        phase_start = now()
    heap = []
    edge_data = {}
    edge_id = 0
    for i in range(len(edges_arr)):
        v0, v1 = int(edges_arr[i, 0]), int(edges_arr[i, 1])
        region_id = int(vertex_regions[v0])
        pos = project_point_to_plane(
            init_positions[i].copy(),
            region_normals[region_id],
            region_offsets[region_id],
        )
        cost = float(quadric_cost(Q[v0] + Q[v1], pos))
        heappush(heap, (cost, edge_id, v0, v1))
        edge_data[(v0, v1)] = (cost, pos)
        edge_id += 1
    if profile_enabled:
        profile.heap_seed_seconds += now() - phase_start
        profile.heap_seeded_edges = len(heap)

    face_count = n_faces
    iteration = 0

    if profile_enabled:
        loop_start = now()
    while heap and (max_iterations is None or iteration < max_iterations):
        if profile_enabled:
            phase_start = now()
            profile.heap_pops += 1
        cost, eid, v0, v1 = heappop(heap)
        if profile_enabled:
            profile.heap_pop_seconds += now() - phase_start

        if not vert_alive[v0] or not vert_alive[v1]:
            if profile_enabled:
                profile.rejected_dead_vertices += 1
            continue

        key = (v0, v1)
        if key not in edge_data:
            if profile_enabled:
                profile.rejected_missing_edge += 1
            continue
        stored_cost, stored_pos = edge_data[key]
        if abs(stored_cost - cost) > 1e-12:
            if profile_enabled:
                profile.rejected_cost_mismatch += 1
            continue

        if profile_enabled:
            phase_start = now()
        can_collapse = can_collapse_in_region(v0, v1, vertex_regions, vertex_locked)
        if profile_enabled:
            profile.region_check_seconds += now() - phase_start
        if not can_collapse:
            if profile_enabled:
                profile.rejected_region += 1
            del edge_data[key]
            continue

        region_id = int(vertex_regions[v0])
        if profile_enabled:
            phase_start = now()
        candidate_pos = project_point_to_plane(
            stored_pos,
            region_normals[region_id],
            region_offsets[region_id],
        )
        if profile_enabled:
            profile.projection_seconds += now() - phase_start

        if profile_enabled:
            phase_start = now()
        valid_collapse = check_collapse_jit(v0, v1, candidate_pos, vertices, faces, face_alive)
        if profile_enabled:
            profile.check_collapse_seconds += now() - phase_start
        if not valid_collapse:
            if profile_enabled:
                profile.rejected_check_collapse += 1
            del edge_data[key]
            continue

        if profile_enabled:
            phase_start = now()
        disconnects = would_disconnect(v0, v1, faces, face_alive)
        if profile_enabled:
            profile.disconnect_seconds += now() - phase_start
        if disconnects:
            if profile_enabled:
                profile.rejected_disconnect += 1
            del edge_data[key]
            continue

        del edge_data[key]

        if profile_enabled:
            phase_start = now()
        vertices[v0] = candidate_pos
        Q[v0] += Q[v1]
        if profile_enabled:
            profile.collapse_update_seconds += now() - phase_start

        if profile_enabled:
            phase_start = now()
        shared = find_shared_faces(v0, v1, faces, face_alive, n_faces)
        if profile_enabled:
            profile.shared_faces_seconds += now() - phase_start
            profile.shared_faces_removed += len(shared)
        for fi in shared:
            face_alive[fi] = False
        face_count -= len(shared)

        if profile_enabled:
            phase_start = now()
        affected = reassign_v1_to_v0(v0, v1, faces, face_alive, n_faces)
        if profile_enabled:
            profile.reassign_seconds += now() - phase_start
            profile.reassign_updates += len(affected)
        vert_alive[v1] = False
        vertex_regions[v1] = -1

        # Remove stale edge entries involving v0
        if profile_enabled:
            phase_start = now()
        stale = [k for k in edge_data if v0 in k]
        if profile_enabled:
            profile.stale_cleanup_seconds += now() - phase_start
            profile.stale_cleanup_scans += 1
            profile.stale_edges_removed += len(stale)
        for k in stale:
            del edge_data[k]

        # Find neighbors (JIT)
        if profile_enabled:
            phase_start = now()
        neighbors = find_neighbor_verts(v0, vert_alive, faces, face_alive)
        if profile_enabled:
            profile.neighbor_search_seconds += now() - phase_start
            profile.neighbor_vertices += len(neighbors)

        # Recompute edge costs
        if profile_enabled:
            phase_start = now()
        for vn in neighbors:
            vn = int(vn)
            if not can_collapse_in_region(v0, vn, vertex_regions, vertex_locked):
                continue
            ekey = (min(v0, vn), max(v0, vn))
            c, x, y, z = compute_edge_cost(Q[v0], Q[vn], vertices[v0], vertices[vn])
            pos = project_point_to_plane(
                np.array([x, y, z], dtype=np.float64),
                region_normals[region_id],
                region_offsets[region_id],
            )
            new_cost = float(quadric_cost(Q[v0] + Q[vn], pos))
            edge_data[ekey] = (new_cost, pos)
            heappush(heap, (new_cost, edge_id, ekey[0], ekey[1]))
            edge_id += 1
        if profile_enabled:
            profile.recompute_edge_seconds += now() - phase_start
            profile.recomputed_edges += len(neighbors)
            profile.accepted_collapses += 1

        iteration += 1
        if iteration % 100 == 0:
            log(f"  Iteration {iteration}: {face_count} faces remaining, "
                  f"last cost: {cost:.6e}")

    if profile_enabled:
        profile.loop_seconds += now() - loop_start

    # Build simplified mesh
    if profile_enabled:
        phase_start = now()
    old_to_new = {}
    new_vertices = []
    idx = 0
    for i in range(n_verts):
        if vert_alive[i]:
            old_to_new[i] = idx
            new_vertices.append(vertices[i].copy())
            idx += 1

    new_faces = []
    for fi in range(n_faces):
        if face_alive[fi]:
            nf = [old_to_new[int(faces[fi, j])] for j in range(3)]
            if len(set(nf)) == 3:
                new_faces.append(nf)

    simplified = trimesh.Trimesh(
        vertices=np.array(new_vertices, dtype=np.float64).reshape((-1, 3)),
        faces=np.array(new_faces, dtype=np.int64).reshape((-1, 3)),
        process=False,
    )
    if profile_enabled:
        profile.build_mesh_seconds += now() - phase_start

    # Keep only the largest connected component when there are faces left.
    if profile_enabled:
        phase_start = now()
    if len(simplified.faces) > 0:
        components = simplified.split(only_watertight=False)
        if len(components) > 1:
            largest = max(components, key=lambda c: len(c.faces))
            n_removed = len(simplified.faces) - len(largest.faces)
            log(f"  Removed {len(components) - 1} stray components "
                  f"({n_removed} faces)")
            simplified = largest
    else:
        log("  Simplification removed all faces")
    if profile_enabled:
        profile.split_seconds += now() - phase_start

    reduction = (1.0 - len(simplified.faces) / original_faces) * 100
    log(f"\nQEM Simplification complete:")
    log(f"  Starting faces: {original_faces}")
    log(f"  Ending faces:   {len(simplified.faces)}")
    log(f"  Reduction:      {reduction:.1f}%")
    log(f"  Starting verts: {n_verts}")
    log(f"  Ending verts:   {len(simplified.vertices)}")

    if profile_enabled:
        profile.final_vertices = len(simplified.vertices)
        profile.final_faces = len(simplified.faces)
        profile.total_seconds += now() - total_start

    return simplified


simplify_mesh = qem_simplify
simplify_trimesh = qem_simplify


def simplify_mesh_data(
    vertices,
    faces,
    max_iterations=None,
    planar_angle_degrees=0.01,
    planar_distance_tol=None,
    verbose=False,
    min_region_faces=3,
    profile=None,
):
    """Simplify raw vertex / face arrays and return a trimesh.Trimesh."""
    vertices_array = np.asarray(vertices, dtype=np.float64)
    if vertices_array.ndim != 2 or vertices_array.shape[1] < 3:
        raise ValueError(f"Expected a vertex matrix with at least 3 columns, got {vertices_array.shape}.")

    mesh = trimesh.Trimesh(
        vertices=np.ascontiguousarray(vertices_array[:, :3], dtype=np.float64),
        faces=np.ascontiguousarray(ensure_triangle_faces(faces), dtype=np.int64),
        process=False,
    )
    return qem_simplify(
        mesh,
        max_iterations=max_iterations,
        planar_angle_degrees=planar_angle_degrees,
        planar_distance_tol=planar_distance_tol,
        verbose=verbose,
        min_region_faces=min_region_faces,
        profile=profile,
    )


simplify_arrays = simplify_mesh_data
