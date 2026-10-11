# Copyright (c) 2010-2012 Anders Wallin (anders.e.e.wallin "at" gmail.com).
# Python adaptation copyright (c) 2026 OpenCAM contributors.
#
# MIC traversal, maximum cut-width, bi-tangent, and scoop-path concepts are
# derived from OpenVoronoi's medial_axis_pocket implementation and
# python_examples/ma-pocket/ma_pocket_08_cpp.py:
# https://github.com/aewallin/openvoronoi
#
# This file is distributed under GNU Lesser General Public License 2.1 or
# later. See LICENSES/OpenVoronoi-LGPL-2.1.txt.

from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import pairwise
from typing import Literal

import networkx as nx
import numpy as np
from scipy.spatial import QhullError, Voronoi
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import orient, substring, unary_union

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.pocketing.linking import (
    _build_keep_down_link,
    build_tool_center_region,
)
from opencam.engine.pocketing.models import Coordinate2D

MAX_BOUNDARY_SAMPLES = 4_000
MINIMUM_RADIUS = 1e-9
STEPUNDER_FRACTION = 0.9
SPIRAL_LENGTH_FACTOR = 1.2


@dataclass(frozen=True)
class MaximalInscribedCircle:
    center: Coordinate2D
    radius: float


def build_adaptive_pocket_layers(
    polyline: np.ndarray,
    *,
    tool_diameter: float,
    stepover_percent: float,
    stock_to_leave: float,
    chord_tolerance: float,
    cut_direction: Literal["climb", "conventional"] = "climb",
) -> list[np.ndarray]:
    """Build proof-of-principle medial-axis clearing paths for one Z level."""
    if not 0 < stepover_percent <= 100:
        raise ValueError("Stepover must be greater than 0% and no more than 100%.")

    base_polyline = validate_closed_polyline(polyline)
    center_region = build_tool_center_region(
        base_polyline,
        tool_diameter=tool_diameter,
        stock_to_leave=stock_to_leave,
        chord_tolerance=chord_tolerance,
    )
    components = [
        polygon
        for polygon in _polygon_parts(center_region)
        if polygon.area > chord_tolerance * chord_tolerance
    ]
    if not components:
        return []

    requested_cut_width = tool_diameter * stepover_percent / 100
    effective_cut_width = requested_cut_width * STEPUNDER_FRACTION
    coverage_slack = requested_cut_width - effective_cut_width
    sample_spacing = max(chord_tolerance * 4, effective_cut_width / 2)
    tool_radius = tool_diameter / 2
    target_region = Polygon(base_polyline)
    if stock_to_leave > 0:
        target_region = target_region.buffer(
            -stock_to_leave,
            quad_segs=quad_segs_for_tolerance(stock_to_leave, chord_tolerance),
        )
    coverage_quad_segs = quad_segs_for_tolerance(
        tool_radius,
        chord_tolerance / 4,
    )
    paths: list[np.ndarray] = []

    for component in sorted(components, key=_polygon_sort_key):
        component_target = target_region.intersection(
            component.buffer(tool_radius, quad_segs=coverage_quad_segs)
        )
        component_paths = _build_component_paths(
            component,
            target_region=component_target,
            tool_radius=tool_radius,
            maximum_cut_width=effective_cut_width,
            coverage_slack=coverage_slack,
            sample_spacing=sample_spacing,
            chord_tolerance=chord_tolerance,
            coverage_quad_segs=coverage_quad_segs,
            cut_direction=cut_direction,
        )
        paths.extend(component_paths)

    return paths


def _polygon_parts(geometry: BaseGeometry) -> list[Polygon]:
    if geometry.is_empty:
        return []
    if isinstance(geometry, Polygon):
        return [geometry]
    if hasattr(geometry, "geoms"):
        return [part for part in geometry.geoms if isinstance(part, Polygon)]
    return []


def _polygon_sort_key(polygon: Polygon) -> tuple[float, float, float]:
    point = polygon.representative_point()
    return (round(point.x, 6), round(point.y, 6), -polygon.area)


def _boundary_cleanup_paths(
    component: Polygon,
    *,
    cut_direction: Literal["climb", "conventional"],
) -> list[np.ndarray]:
    # shapely orient(sign=1.0) yields an exterior ring wound CCW and interior
    # rings (island holes) wound CW, which keeps the pocket material on the
    # tool's left side everywhere: climb milling for a clockwise spindle.
    # Conventional milling mirrors every ring.
    sign = 1.0 if cut_direction == "climb" else -1.0
    oriented = orient(component, sign=sign)
    rings = [oriented.exterior, *oriented.interiors]
    return [
        np.ascontiguousarray(np.asarray(ring.coords, dtype=np.float64)[:, :2])
        for ring in rings
        if len(ring.coords) >= 4
    ]


def _prune_redundant_paths(
    paths: list[np.ndarray],
    *,
    prunable_path_ids: set[int],
    target_region: BaseGeometry,
    tool_radius: float,
    separation_tolerance: float,
    coverage_tolerance: float,
    coverage_quad_segs: int,
) -> list[np.ndarray]:
    """Drop redundant paths whose material stays covered within tolerance.

    Removal is only accepted when the residual uncovered material is thinner
    than coverage_tolerance, so effective local stepover never exceeds the
    requested stepover by more than that tolerance. Candidates are filtered
    by a cheap near-neighbor test first: a path whose vertices average
    farther than separation_tolerance from every other path carries unique
    material and is not worth the full coverage union.
    """
    retained = list(paths)
    candidates = sorted(
        (path for path in paths if id(path) in prunable_path_ids),
        key=lambda path: LineString(path).length,
    )

    for candidate in candidates:
        if not _is_near_redundant(
            candidate,
            [path for path in retained if path is not candidate],
            separation_tolerance=separation_tolerance,
        ):
            continue
        trial = [path for path in retained if path is not candidate]
        swept_area = unary_union(
            [
                LineString(path).buffer(
                    tool_radius,
                    quad_segs=coverage_quad_segs,
                )
                for path in trial
                if path.shape[0] >= 2
            ]
        )
        residual = target_region.difference(swept_area)
        if residual.is_empty or residual.buffer(-coverage_tolerance).is_empty:
            retained = trial

    return retained


def _is_near_redundant(
    candidate: np.ndarray,
    others: list[np.ndarray],
    *,
    separation_tolerance: float,
) -> bool:
    if not others or candidate.shape[0] < 2:
        return False
    sampled = candidate[:: max(1, candidate.shape[0] // 24)]
    tolerance_squared = separation_tolerance * separation_tolerance
    for point in sampled:
        nearest = min(
            float(np.min(np.sum((path - point) ** 2, axis=1)))
            for path in others
            if path.shape[0] >= 2
        )
        if nearest > tolerance_squared:
            return False
    return True


def _build_component_paths(
    component: Polygon,
    *,
    target_region: BaseGeometry,
    tool_radius: float,
    maximum_cut_width: float,
    coverage_slack: float,
    sample_spacing: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
) -> list[np.ndarray]:
    medial_axis = _build_medial_axis_graph(
        component,
        sample_spacing=sample_spacing,
        chord_tolerance=chord_tolerance,
    )
    cleanup_paths = _boundary_cleanup_paths(component, cut_direction=cut_direction)
    if medial_axis.number_of_nodes() == 0:
        center = component.representative_point()
        radius = component.boundary.distance(center)
        if radius <= MINIMUM_RADIUS:
            return cleanup_paths
        return [
            _spiral_path(
                MaximalInscribedCircle((center.x, center.y), radius),
                maximum_cut_width=maximum_cut_width,
                chord_tolerance=chord_tolerance,
                cut_direction=cut_direction,
            ),
            *cleanup_paths,
        ]

    paths: list[np.ndarray] = []
    prunable_path_ids: set[int] = set()
    for node_ids in sorted(
        nx.connected_components(medial_axis),
        key=lambda ids: _component_sort_key(medial_axis, ids),
    ):
        graph = medial_axis.subgraph(node_ids)
        root_id = max(
            graph.nodes,
            key=lambda node_id: (
                graph.nodes[node_id]["circle"].radius,
                -graph.nodes[node_id]["circle"].center[0],
                -graph.nodes[node_id]["circle"].center[1],
            ),
        )
        root_circle = graph.nodes[root_id]["circle"]
        paths.append(
            _spiral_path(
                root_circle,
                maximum_cut_width=maximum_cut_width,
                chord_tolerance=chord_tolerance,
                cut_direction=cut_direction,
            )
        )

        scoop_paths = _build_depth_first_scoop_paths(
            component,
            graph,
            root_id,
            maximum_cut_width=maximum_cut_width,
            chord_tolerance=chord_tolerance,
            tool_radius=tool_radius,
            coverage_tolerance=coverage_slack + chord_tolerance,
            coverage_quad_segs=coverage_quad_segs,
            cut_direction=cut_direction,
        )
        paths.extend(scoop_paths)
        prunable_path_ids.update(id(scoop) for scoop in scoop_paths)

    paths.extend(cleanup_paths)
    retained = _prune_redundant_paths(
        paths,
        prunable_path_ids=prunable_path_ids,
        target_region=target_region,
        tool_radius=tool_radius,
        separation_tolerance=maximum_cut_width * 0.5,
        coverage_tolerance=coverage_slack + chord_tolerance,
        coverage_quad_segs=coverage_quad_segs,
    )
    cleanup_ids = {id(path) for path in cleanup_paths}
    cut_paths = [path for path in retained if id(path) not in cleanup_ids]
    final_cleanup = [path for path in retained if id(path) in cleanup_ids]
    ordered = _chain_nearest_paths(
        cut_paths,
        maximum_link_distance=1.5 * maximum_cut_width,
        tool_radius=tool_radius,
        chord_tolerance=chord_tolerance,
        coverage_quad_segs=coverage_quad_segs,
    )
    return _integrate_boundary_cleanup(
        ordered,
        final_cleanup,
        component=component,
        target_region=target_region,
        tool_radius=tool_radius,
        maximum_cut_width=maximum_cut_width,
        coverage_tolerance=coverage_slack + chord_tolerance,
        chord_tolerance=chord_tolerance,
        coverage_quad_segs=coverage_quad_segs,
    )


def _integrate_boundary_cleanup(
    paths: list[np.ndarray],
    cleanup_paths: list[np.ndarray],
    *,
    component: Polygon,
    target_region: BaseGeometry,
    tool_radius: float,
    maximum_cut_width: float,
    coverage_tolerance: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
) -> list[np.ndarray]:
    """Attach only needed contour portions to nearby, already-cleared scoops.

    Never exchange the full cleanup loop for fragments if any reachable stock
    remains: step-over slack is not a finish tolerance for pocket walls.
    """
    if not paths or not cleanup_paths:
        return paths + cleanup_paths

    centerlines = [LineString(path) for path in paths]
    existing_centerlines = unary_union(centerlines)
    proposed: dict[int, np.ndarray] = {}
    swept: BaseGeometry | None = None
    cleared_after: list[BaseGeometry] = []
    for centerline in centerlines:
        cut = centerline.buffer(tool_radius, quad_segs=coverage_quad_segs)
        swept = cut if swept is None else swept.union(cut)
        cleared_after.append(swept.buffer(chord_tolerance))

    for ring_path in cleanup_paths:
        ring = LineString(ring_path)
        sample_count = max(
            1,
            math.ceil(ring.length / max(coverage_tolerance, maximum_cut_width / 8)),
        )
        spacing = ring.length / sample_count
        needed = [
            existing_centerlines.distance(ring.interpolate((index + 0.5) * spacing))
            > coverage_tolerance
            for index in range(sample_count)
        ]
        intervals: list[tuple[float, float]] = []
        start: int | None = None
        for index, required in enumerate([*needed, False]):
            if required and start is None:
                start = index
            elif not required and start is not None:
                intervals.append(
                    (max(0, (start - 1) * spacing), min(ring.length, (index + 1) * spacing))
                )
                start = None
        fragments = [
            np.asarray(substring(ring, first, last).coords, dtype=np.float64)
            for first, last in intervals
        ]
        if len(fragments) > 1 and needed[0] and needed[-1]:
            fragments[0] = np.vstack((fragments[-1], fragments[0][1:]))
            fragments.pop()

        for fragment in fragments:
            start_point = fragment[0]
            fragment_line = LineString(fragment)
            candidates = sorted(
                range(len(paths)),
                key=lambda index: float(np.linalg.norm(paths[index][-1] - start_point)),
            )
            for index in candidates:
                endpoint = paths[index][-1]
                distance = float(np.linalg.norm(endpoint - start_point))
                if distance > 2 * tool_radius:
                    break
                cleared = cleared_after[index]
                if not cleared.covers(fragment_line):
                    continue
                if index in proposed:
                    continue
                connector = _cleared_border_connector(
                    ring,
                    endpoint,
                    start_point,
                    component=component,
                    cleared=cleared,
                    maximum_distance=2 * tool_radius,
                    chord_tolerance=chord_tolerance,
                )
                if connector is not None:
                    extension = _extend_to_previous_border_touch(
                        ring,
                        fragment,
                        paths[:index],
                        component=component,
                        cleared=cleared,
                        maximum_distance=2 * tool_radius + maximum_cut_width,
                        chord_tolerance=chord_tolerance,
                    )
                    if index + 1 < len(paths) and extension.shape[0] > fragment.shape[0]:
                        original_path = np.vstack((paths[index], connector[1:], fragment[1:]))
                        extended_path = np.vstack((paths[index], connector[1:], extension[1:]))
                        safe_region = component.buffer(chord_tolerance * 1e-6)
                        next_path = paths[index + 1]
                        if (
                            _build_keep_down_link(
                                original_path,
                                next_path,
                                safe_region=safe_region,
                                tool_diameter=2 * tool_radius,
                                chord_tolerance=chord_tolerance,
                            )
                            is not None
                            and _build_keep_down_link(
                                extended_path,
                                next_path,
                                safe_region=safe_region,
                                tool_diameter=2 * tool_radius,
                                chord_tolerance=chord_tolerance,
                            )
                            is None
                        ):
                            extension = fragment
                    proposed[index] = np.vstack((connector, extension[1:]))
                    break
            # A fragment without a cleared in-bounds connector is omitted;
            # remaining stock below determines whether the loop stays.

    enriched = [
        np.ascontiguousarray(np.vstack((path, proposed[index][1:])))
        if index in proposed
        else path
        for index, path in enumerate(paths)
    ]
    coverage = unary_union(
        [
            LineString(path).buffer(tool_radius, quad_segs=coverage_quad_segs)
            for path in enriched
        ]
    )
    residual = target_region.difference(coverage)
    if residual.is_empty:
        return enriched
    return paths + cleanup_paths


def _forward_ring_segment(ring: LineString, first: float, last: float) -> np.ndarray:
    if last >= first:
        return np.asarray(substring(ring, first, last).coords, dtype=np.float64)
    return np.vstack(
        (
            np.asarray(substring(ring, first, ring.length).coords, dtype=np.float64),
            np.asarray(substring(ring, 0, last).coords, dtype=np.float64)[1:],
        )
    )


def _extend_to_previous_border_touch(
    ring: LineString,
    fragment: np.ndarray,
    previous_paths: list[np.ndarray],
    *,
    component: Polygon,
    cleared: BaseGeometry,
    maximum_distance: float,
    chord_tolerance: float,
) -> np.ndarray:
    """Continue contour to next prior pass's actual border contact when safe."""
    end_station = ring.project(Point(fragment[-1]))
    contacts = sorted(
        {
            ring.project(point)
            for path in previous_paths
            for coordinate in (path[0], path[-1])
            if (point := Point(coordinate)).distance(ring) <= chord_tolerance
        },
        key=lambda station: (station - end_station) % ring.length,
    )
    safe_region = component.buffer(chord_tolerance * 1e-6)
    for station in contacts:
        advance = (station - end_station) % ring.length
        if advance <= chord_tolerance:
            continue
        if advance > maximum_distance:
            break
        continuation = _forward_ring_segment(ring, end_station, station)
        if (
            safe_region.covers(LineString(continuation))
            and cleared.covers(LineString(continuation))
        ):
            return np.vstack((fragment, continuation[1:]))
    return fragment


def _cleared_border_connector(
    ring: LineString,
    endpoint: np.ndarray,
    start_point: np.ndarray,
    *,
    component: Polygon,
    cleared: BaseGeometry,
    maximum_distance: float,
    chord_tolerance: float,
) -> np.ndarray | None:
    """Connect to contour through already-swept, in-bounds material."""
    direct = np.vstack((endpoint, start_point))
    safe_region = component.buffer(chord_tolerance * 1e-6)
    if safe_region.covers(LineString(direct)) and cleared.covers(LineString(direct)):
        return direct

    first = ring.project(Point(endpoint))
    last = ring.project(Point(start_point))
    forward = (last - first) % ring.length
    backward = (first - last) % ring.length
    if min(forward, backward) > maximum_distance:
        return None
    border = (
        _forward_ring_segment(ring, first, last)
        if forward <= backward
        else _forward_ring_segment(ring, last, first)[::-1]
    )
    connector = np.vstack((endpoint, border, start_point))
    if safe_region.covers(LineString(connector)) and cleared.covers(LineString(connector)):
        return connector
    return None


def _chain_nearest_paths(
    paths: list[np.ndarray],
    *,
    maximum_link_distance: float,
    tool_radius: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
) -> list[np.ndarray]:
    """Prefer scoops within material already swept by earlier passes.

    Paths are never reversed: a reversal flips the handedness of loop-like
    scoops and the cleanup ring, switching them from climb to conventional
    milling. Cleared paths take priority even across longer transfers; when
    none remain, the nearest path is chosen within maximum_link_distance.
    Otherwise the remaining depth-first order is kept.
    """
    if len(paths) < 2:
        return list(paths)

    ordered = [paths[0]]
    remaining = list(paths[1:])
    swept = LineString(paths[0]).buffer(tool_radius, quad_segs=coverage_quad_segs)
    while remaining:
        current_end = ordered[-1][-1]
        best_index = 0
        best_distance = float("inf")
        safe_index: int | None = None
        safe_distance = float("inf")
        cleared = swept.buffer(chord_tolerance)
        for index, path in enumerate(remaining):
            start_distance = float(np.linalg.norm(current_end - path[0]))
            if start_distance < best_distance:
                best_distance = start_distance
                best_index = index
            if start_distance < safe_distance and cleared.covers(LineString(path)):
                safe_index = index
                safe_distance = start_distance
        if safe_index is not None:
            best_index = safe_index
        elif best_distance > maximum_link_distance:
            ordered.extend(remaining)
            break
        next_path = remaining.pop(best_index)
        ordered.append(next_path)
        swept = swept.union(LineString(next_path).buffer(tool_radius, quad_segs=coverage_quad_segs))
    return ordered


def _component_sort_key(
    graph: nx.Graph,
    node_ids: set[int],
) -> tuple[float, float, float]:
    circles = [graph.nodes[node_id]["circle"] for node_id in node_ids]
    largest = max(circles, key=lambda circle: circle.radius)
    return (largest.center[0], largest.center[1], -largest.radius)


def _build_medial_axis_graph(
    component: Polygon,
    *,
    sample_spacing: float,
    chord_tolerance: float,
) -> nx.Graph:
    boundary_samples = _sample_polygon_boundary(component, sample_spacing)
    graph = nx.Graph()
    if boundary_samples.shape[0] < 4:
        return graph

    try:
        diagram = Voronoi(boundary_samples)
    except QhullError:
        return graph

    tolerance_region = component.buffer(max(chord_tolerance, MINIMUM_RADIUS))
    for ridge_vertex_ids in diagram.ridge_vertices:
        if len(ridge_vertex_ids) != 2 or min(ridge_vertex_ids) < 0:
            continue

        first_id, second_id = ridge_vertex_ids
        first = diagram.vertices[first_id]
        second = diagram.vertices[second_id]
        edge = LineString((first, second))
        if edge.length <= MINIMUM_RADIUS or not tolerance_region.covers(edge):
            continue

        for node_id, coordinate in ((first_id, first), (second_id, second)):
            if node_id in graph:
                continue
            center = (float(coordinate[0]), float(coordinate[1]))
            radius = float(component.boundary.distance(Point(center)))
            if radius > MINIMUM_RADIUS:
                graph.add_node(
                    node_id,
                    circle=MaximalInscribedCircle(center=center, radius=radius),
                )

        if first_id in graph and second_id in graph:
            graph.add_edge(first_id, second_id, length=float(edge.length))

    graph.remove_nodes_from(list(nx.isolates(graph)))
    return graph


def _sample_polygon_boundary(polygon: Polygon, spacing: float) -> np.ndarray:
    rings = [polygon.exterior, *polygon.interiors]
    total_length = sum(ring.length for ring in rings)
    actual_spacing = max(spacing, total_length / MAX_BOUNDARY_SAMPLES)
    coordinates: list[Coordinate2D] = []

    for ring in rings:
        sample_count = max(4, math.ceil(ring.length / actual_spacing))
        for index in range(sample_count):
            point = ring.interpolate(index * ring.length / sample_count)
            coordinates.append((float(point.x), float(point.y)))

    return np.ascontiguousarray(coordinates, dtype=np.float64)


def _build_depth_first_scoop_paths(
    component: Polygon,
    graph: nx.Graph,
    root_id: int,
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    tool_radius: float,
    coverage_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
) -> list[np.ndarray]:
    tree = nx.dfs_tree(
        graph,
        root_id,
        sort_neighbors=lambda ids, active_graph=graph: sorted(
            ids,
            key=lambda node_id: (
                -active_graph.nodes[node_id]["circle"].radius,
                active_graph.nodes[node_id]["circle"].center,
            ),
        ),
    )
    paths: list[np.ndarray] = []
    pending = [
        (root_id, child_id) for child_id in reversed(list(tree.successors(root_id)))
    ]

    while pending:
        branch_start_id, current_id = pending.pop()
        circles = [
            graph.nodes[branch_start_id]["circle"],
            graph.nodes[current_id]["circle"],
        ]

        while tree.out_degree(current_id) == 1:
            current_id = next(iter(tree.successors(current_id)))
            circles.append(graph.nodes[current_id]["circle"])

        transitions = _constrain_circle_chain(
            component,
            circles,
            maximum_cut_width=maximum_cut_width,
        )
        scoops = [
            scoop
            for first, second in transitions
            if (
                scoop := _scoop_path(first, second, chord_tolerance=chord_tolerance)
            ).shape[0]
            >= 2
        ]
        if cut_direction == "conventional":
            # Mirror the whole branch: leaf-most scoop first, each path
            # reversed, so travel runs along the medial chain in the opposite
            # direction and every scoop cuts conventionally instead of climb.
            scoops = [np.ascontiguousarray(scoop[::-1]) for scoop in reversed(scoops)]
        spiral = _round_branch_spiral(
            circles,
            scoops,
            maximum_cut_width=maximum_cut_width,
            chord_tolerance=chord_tolerance,
            tool_radius=tool_radius,
            coverage_tolerance=coverage_tolerance,
            coverage_quad_segs=coverage_quad_segs,
        )
        if spiral is not None:
            paths.append(spiral)
        else:
            paths.extend(scoops)

        pending.extend(
            (current_id, child_id)
            for child_id in reversed(list(tree.successors(current_id)))
        )

    return paths


def _round_branch_spiral(
    circles: list[MaximalInscribedCircle],
    scoops: list[np.ndarray],
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    tool_radius: float,
    coverage_tolerance: float,
    coverage_quad_segs: int,
) -> np.ndarray | None:
    """Replace a compact round branch's scoops with one spiral when safe.

    A branch whose circles stay near the largest circle's radius and whose
    centerline is short describes a round pocket. Semicircle scoops there
    reverse direction (corner-poke artifacts); a spiral clears the same
    material smoothly. The swap is only accepted when the spiral sweeps at
    least as much material as the scoops, minus coverage_tolerance.
    """
    if not scoops:
        return None

    widest = max(circles, key=lambda circle: circle.radius)
    centerline_length = sum(
        math.dist(first.center, second.center) for first, second in pairwise(circles)
    )
    is_compact = (
        len(circles) >= 3
        and widest.radius > MINIMUM_RADIUS
        and all(circle.radius >= 0.8 * widest.radius for circle in circles)
        and centerline_length <= 1.5 * widest.radius
    )
    if not is_compact:
        return None

    spiral = _spiral_path(
        widest,
        maximum_cut_width=maximum_cut_width,
        chord_tolerance=chord_tolerance,
    )
    if LineString(spiral).length > SPIRAL_LENGTH_FACTOR * sum(
        LineString(scoop).length for scoop in scoops
    ):
        return None
    scoop_coverage = unary_union(
        [
            LineString(scoop).buffer(tool_radius, quad_segs=coverage_quad_segs)
            for scoop in scoops
        ]
    )
    spiral_coverage = LineString(spiral).buffer(
        tool_radius,
        quad_segs=coverage_quad_segs,
    )
    residual = scoop_coverage.difference(spiral_coverage)
    if residual.buffer(-coverage_tolerance).is_empty:
        return spiral
    return None


def _constrain_circle_chain(
    component: Polygon,
    circles: list[MaximalInscribedCircle],
    *,
    maximum_cut_width: float,
) -> list[tuple[MaximalInscribedCircle, MaximalInscribedCircle]]:
    transitions: list[tuple[MaximalInscribedCircle, MaximalInscribedCircle]] = []
    last_emitted = circles[0]

    for edge_start, edge_end in pairwise(circles):
        current_fraction = 0.0
        while _cut_width(last_emitted, edge_end) > maximum_cut_width * (1 + 1e-9):
            low = current_fraction
            high = 1.0
            for _ in range(60):
                middle = (low + high) / 2
                candidate = _circle_at_fraction(
                    component,
                    edge_start,
                    edge_end,
                    middle,
                )
                if _cut_width(last_emitted, candidate) < maximum_cut_width:
                    low = middle
                else:
                    high = middle

            next_fraction = high
            if next_fraction - current_fraction <= 1e-12:
                break
            next_circle = _circle_at_fraction(
                component,
                edge_start,
                edge_end,
                next_fraction,
            )
            transitions.append((last_emitted, next_circle))
            last_emitted = next_circle
            current_fraction = next_fraction

    branch_end = circles[-1]
    if _cut_width(last_emitted, branch_end) > MINIMUM_RADIUS:
        transitions.append((last_emitted, branch_end))
    return transitions


def _circle_at_fraction(
    component: Polygon,
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
    fraction: float,
) -> MaximalInscribedCircle:
    x = first.center[0] + (second.center[0] - first.center[0]) * fraction
    y = first.center[1] + (second.center[1] - first.center[1]) * fraction
    return MaximalInscribedCircle(
        center=(x, y),
        radius=float(component.boundary.distance(Point(x, y))),
    )


def _cut_width(
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
) -> float:
    return math.dist(first.center, second.center) + second.radius - first.radius


def _spiral_path(
    circle: MaximalInscribedCircle,
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    cut_direction: Literal["climb", "conventional"] = "climb",
) -> np.ndarray:
    turns = max(1, math.ceil(circle.radius / maximum_cut_width))
    end_angle = math.tau * turns
    direction = 1.0 if cut_direction == "climb" else -1.0
    angle_step = _angle_step(circle.radius, chord_tolerance)
    sample_count = max(16, math.ceil(end_angle / angle_step))
    angles = direction * np.linspace(0.0, end_angle, sample_count + 1)
    radii = circle.radius * np.abs(angles) / end_angle
    x = circle.center[0] + radii * np.cos(angles)
    y = circle.center[1] + radii * np.sin(angles)
    spiral = np.column_stack((x, y))

    outer_circle = _sample_arc(
        center=circle.center,
        radius=circle.radius,
        start_angle=direction * end_angle,
        sweep_angle=direction * math.tau,
        chord_tolerance=chord_tolerance,
    )
    return np.ascontiguousarray(np.vstack((spiral, outer_circle[1:])), dtype=np.float64)


def _scoop_path(
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
    *,
    chord_tolerance: float,
) -> np.ndarray:
    tangent_points = _bitangent_points(first, second)
    if tangent_points is None:
        return np.empty((0, 2), dtype=np.float64)
    first_out, first_in, second_out, second_in = tangent_points

    start_angle = math.atan2(
        second_in[1] - second.center[1],
        second_in[0] - second.center[0],
    )
    end_angle = math.atan2(
        second_out[1] - second.center[1],
        second_out[0] - second.center[0],
    )
    counterclockwise_sweep = (end_angle - start_angle) % math.tau
    clockwise_sweep = counterclockwise_sweep - math.tau
    sweep_angle = max(
        (counterclockwise_sweep, clockwise_sweep),
        key=lambda sweep: _exposed_arc_score(first, second, start_angle, sweep),
    )
    arc = _sample_arc(
        center=second.center,
        radius=second.radius,
        start_angle=start_angle,
        sweep_angle=sweep_angle,
        chord_tolerance=chord_tolerance,
    )
    return np.ascontiguousarray(
        np.vstack(
            (
                np.asarray(first_in),
                np.asarray(second_in),
                arc[1:],
                np.asarray(first_out),
            )
        ),
        dtype=np.float64,
    )


def _bitangent_points(
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
) -> tuple[Coordinate2D, Coordinate2D, Coordinate2D, Coordinate2D] | None:
    dx = second.center[0] - first.center[0]
    dy = second.center[1] - first.center[1]
    distance = math.hypot(dx, dy)
    if distance <= MINIMUM_RADIUS:
        return None

    radius_delta_ratio = (first.radius - second.radius) / distance
    if abs(radius_delta_ratio) > 1 + 1e-7:
        return None
    radius_delta_ratio = max(-1.0, min(1.0, radius_delta_ratio))
    perpendicular_ratio = math.sqrt(
        max(0.0, 1 - radius_delta_ratio * radius_delta_ratio)
    )
    unit_x = dx / distance
    unit_y = dy / distance
    normals = (
        (
            radius_delta_ratio * unit_x - perpendicular_ratio * unit_y,
            radius_delta_ratio * unit_y + perpendicular_ratio * unit_x,
        ),
        (
            radius_delta_ratio * unit_x + perpendicular_ratio * unit_y,
            radius_delta_ratio * unit_y - perpendicular_ratio * unit_x,
        ),
    )

    first_points = [
        (
            first.center[0] + first.radius * normal[0],
            first.center[1] + first.radius * normal[1],
        )
        for normal in normals
    ]
    second_points = [
        (
            second.center[0] + second.radius * normal[0],
            second.center[1] + second.radius * normal[1],
        )
        for normal in normals
    ]
    return first_points[0], first_points[1], second_points[0], second_points[1]


def _exposed_arc_score(
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
    start_angle: float,
    sweep_angle: float,
) -> float:
    middle_angle = start_angle + sweep_angle / 2
    middle = (
        second.center[0] + second.radius * math.cos(middle_angle),
        second.center[1] + second.radius * math.sin(middle_angle),
    )
    return math.dist(middle, first.center) - first.radius


def _sample_arc(
    *,
    center: Coordinate2D,
    radius: float,
    start_angle: float,
    sweep_angle: float,
    chord_tolerance: float,
) -> np.ndarray:
    sample_count = max(
        2, math.ceil(abs(sweep_angle) / _angle_step(radius, chord_tolerance))
    )
    angles = np.linspace(start_angle, start_angle + sweep_angle, sample_count + 1)
    return np.ascontiguousarray(
        np.column_stack(
            (
                center[0] + radius * np.cos(angles),
                center[1] + radius * np.sin(angles),
            )
        ),
        dtype=np.float64,
    )


def _angle_step(radius: float, chord_tolerance: float) -> float:
    if radius <= chord_tolerance:
        return math.pi / 8
    return min(math.pi / 8, 2 * math.acos(max(-1.0, 1 - chord_tolerance / radius)))
