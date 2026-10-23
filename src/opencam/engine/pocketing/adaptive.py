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
from shapely import distance as geometry_distance
from shapely import line_interpolate_point
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry
from shapely.ops import orient, substring, unary_union

from opencam.engine.closed_polyline.offset import quad_segs_for_tolerance
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.pocketing.linking import (
    InternalContourLink,
    _end_tangent,
    _start_tangent,
    build_tool_center_region,
)
from opencam.engine.pocketing.models import Coordinate2D

MAX_BOUNDARY_SAMPLES = 4_000
MINIMUM_RADIUS = 1e-9
STEPUNDER_FRACTION = 0.9
SPIRAL_LENGTH_FACTOR = 1.2
MAX_BLEND_TANGENT_STEP = math.radians(2)
MAX_SCOOP_REFINEMENT = 2


@dataclass(frozen=True)
class MaximalInscribedCircle:
    center: Coordinate2D
    radius: float


class LimbScoopPaths(list[np.ndarray]):
    def __init__(self) -> None:
        super().__init__()
        self.limb_owners: dict[int, int] = {}
        self.limb_parents: dict[int, int | None] = {}
        self.circles: dict[int, MaximalInscribedCircle] = {}
        self.fronts: dict[int, np.ndarray] = {}


class AdaptivePocketLayers(list[np.ndarray]):
    def __init__(
        self,
        paths: list[np.ndarray] | None = None,
        internal_links: dict[int, list[InternalContourLink]] | None = None,
        link_support_radii: dict[int, tuple[float, float]] | None = None,
    ) -> None:
        super().__init__(paths or [])
        self.internal_links = internal_links or {}
        self.link_support_radii = link_support_radii or {}
        self.entry_path_ids: set[int] = set()


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
    paths = AdaptivePocketLayers()

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
        if component_paths:
            entry_ids = getattr(component_paths, "entry_path_ids", set()) or {id(component_paths[0])}
            reachable = None
            for index, path in enumerate(component_paths):
                line = LineString(path)
                if id(path) not in entry_ids and reachable is not None and not reachable.covers(line):
                    raise ValueError(
                        f"Adaptive cutting path {index} exceeds requested stepover; "
                        "toolpath generation stopped."
                    )
                sweep = line.buffer(requested_cut_width + chord_tolerance, quad_segs=coverage_quad_segs)
                reachable = sweep if reachable is None else reachable.union(sweep)
        if isinstance(component_paths, AdaptivePocketLayers):
            paths.internal_links.update(
                {len(paths) + index: links for index, links in component_paths.internal_links.items()}
            )
            paths.link_support_radii.update(
                {
                    len(paths) + index: radii
                    for index, radii in component_paths.link_support_radii.items()
                }
            )
        paths.extend(component_paths)

    safe = center_region.buffer(max(MINIMUM_RADIUS, chord_tolerance * 1e-6))
    for index, path in enumerate(paths):
        if len(path) < 2 or not safe.covers(LineString(path)):
            raise ValueError(
                f"Adaptive cutting path {index} leaves the cutter-center region; "
                "toolpath generation stopped."
            )
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
    # tool's right side everywhere: climb milling for a clockwise spindle.
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
    stepover_limit: float,
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
    sweeps = {
        id(path): LineString(path).buffer(
            tool_radius, quad_segs=coverage_quad_segs,
        )
        for path in paths
        if path.shape[0] >= 2
    }
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
        candidate_index = next(
            index for index, path in enumerate(retained) if path is candidate
        )
        if not _preserves_scoop_stepover(
            trial,
            first_changed_index=candidate_index,
            scoop_ids=prunable_path_ids,
            stepover_limit=stepover_limit,
            removed_candidate=candidate,
        ):
            continue
        swept_area = unary_union([sweeps[id(path)] for path in trial if path.shape[0] >= 2])
        residual = target_region.difference(swept_area)
        if residual.is_empty or residual.buffer(-coverage_tolerance).is_empty:
            retained = trial

    return retained


def _preserves_scoop_stepover(
    paths: list[np.ndarray],
    *,
    first_changed_index: int,
    scoop_ids: set[int],
    stepover_limit: float,
    removed_candidate: np.ndarray,
) -> bool:
    """Check only later scoops the removed centerline could have protected."""
    candidate_line = LineString(removed_candidate)
    later: list[np.ndarray] = []
    for path in paths[first_changed_index:]:
        line = LineString(path)
        if id(path) in scoop_ids and candidate_line.distance(line) <= stepover_limit:
            prior = unary_union(
                [LineString(item) for item in (*paths[:first_changed_index], *later)]
            )
            count = max(1, math.ceil(line.length / 0.1))
            spacing = line.length / count
            sampled = line_interpolate_point(line, np.linspace(0, line.length, count + 1))
            maximum = float(np.max(geometry_distance(prior, sampled)))
            # Distance to a fixed set is 1-Lipschitz along the line.
            if maximum > stepover_limit - spacing / 2 and not prior.buffer(
                stepover_limit, quad_segs=16
            ).covers(line):
                return False
        later.append(path)
    return True


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
    limb_owners: dict[int, int] = {}
    limb_parents: dict[int, int | None] = {}
    scoop_circles: dict[int, MaximalInscribedCircle] = {}
    link_support_circles: dict[int, MaximalInscribedCircle] = {}
    scoop_fronts: dict[int, np.ndarray] = {}
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
        root_path = _spiral_path(
            root_circle,
            maximum_cut_width=maximum_cut_width,
            chord_tolerance=chord_tolerance,
            cut_direction=cut_direction,
        )
        paths.append(root_path)
        link_support_circles[id(root_path)] = root_circle
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
        limb_owners.update(scoop_paths.limb_owners)
        limb_parents.update(scoop_paths.limb_parents)
        scoop_circles.update(scoop_paths.circles)
        link_support_circles.update(scoop_paths.circles)
        scoop_fronts.update(scoop_paths.fronts)
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
        stepover_limit=maximum_cut_width + coverage_slack + chord_tolerance,
    )
    cleanup_ids = {id(path) for path in cleanup_paths}
    cut_paths = [path for path in retained if id(path) not in cleanup_ids]
    final_cleanup = [path for path in retained if id(path) in cleanup_ids]
    result = _integrate_boundary_cleanup(
        cut_paths,
        final_cleanup,
        component=component,
        target_region=target_region,
        tool_radius=tool_radius,
        maximum_cut_width=maximum_cut_width,
        chord_tolerance=chord_tolerance,
        coverage_quad_segs=coverage_quad_segs,
        requested_cut_width=maximum_cut_width + coverage_slack,
        limb_owners=limb_owners,
        limb_parents=limb_parents,
        scoop_circles=scoop_circles,
        link_support_circles=link_support_circles,
        scoop_fronts=scoop_fronts,
        cut_direction=cut_direction,
    )
    result.entry_path_ids = {id(path) for path in cut_paths if id(path) not in limb_owners}
    return result


def _integrate_boundary_cleanup(
    paths: list[np.ndarray],
    cleanup_paths: list[np.ndarray],
    *,
    limb_owners: dict[int, int],
    limb_parents: dict[int, int | None],
    scoop_circles: dict[int, MaximalInscribedCircle],
    link_support_circles: dict[int, MaximalInscribedCircle],
    scoop_fronts: dict[int, np.ndarray],
    requested_cut_width: float,
    component: Polygon,
    target_region: BaseGeometry,
    tool_radius: float,
    maximum_cut_width: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
) -> AdaptivePocketLayers:
    """Extend scoops between reached wall contacts and finish only their local caps."""
    if not paths or not cleanup_paths:
        return AdaptivePocketLayers(
            paths + cleanup_paths,
            link_support_radii={
                index: (circle.radius, circle.radius)
                for index, path in enumerate(paths + cleanup_paths)
                if (circle := link_support_circles.get(id(path))) is not None
            },
        )

    last_in_limb = {
        limb_owners[id(path)]: index
        for index, path in enumerate(paths) if id(path) in limb_owners
    }
    nonterminal: set[int] = set()
    for owner in last_in_limb:
        parent = limb_parents.get(owner)
        while parent is not None:
            nonterminal.add(parent)
            parent = limb_parents.get(parent)
    terminal_indices = {
        index for owner, index in last_in_limb.items() if owner not in nonterminal
    }
    rings = [LineString(border) for border in _boundary_cleanup_paths(
        component, cut_direction=cut_direction,
    )]
    contacts: dict[int, tuple[float, float]] = {}
    focus_ends: dict[int, tuple[int, MaximalInscribedCircle]] = {}
    result = AdaptivePocketLayers()
    prior: BaseGeometry | None = None
    reachable: BaseGeometry | None = None
    reachable_with_tolerance: BaseGeometry | None = None
    safe = component.buffer(chord_tolerance * 1e-6)
    for index, path in enumerate(paths):
        circle = scoop_circles.get(id(path))
        bordered = path
        ring = None
        current_contacts = None
        if circle is not None and prior is not None:
            owner = limb_owners[id(path)]
            front = scoop_fronts.get(id(path), path)
            ring = min(rings, key=lambda boundary: max(
                boundary.distance(Point(point)) for point in (front[1], front[-2])
            ))
            bordered, current_contacts = _scoop_border_leads(
                front, circle=circle, ring=ring, prior=prior, safe=safe,
                reachable=reachable,
                reachable_with_tolerance=reachable_with_tolerance,
                previous_contacts=contacts.get(owner),
                chord_tolerance=chord_tolerance,
            )
            if not safe.covers(LineString(bordered)):
                bordered = path
            contacts[owner] = current_contacts
        result.append(bordered)
        support_circle = link_support_circles.get(id(path))
        if support_circle is not None:
            result.link_support_radii[len(result) - 1] = (
                support_circle.radius,
                support_circle.radius,
            )
        line = LineString(bordered)
        prior = line if prior is None else unary_union([prior, line])
        sweep = line.buffer(requested_cut_width, quad_segs=coverage_quad_segs)
        expanded_sweep = line.buffer(
            requested_cut_width + chord_tolerance, quad_segs=coverage_quad_segs,
        )
        reachable = sweep if reachable is None else reachable.union(sweep)
        reachable_with_tolerance = (
            expanded_sweep
            if reachable_with_tolerance is None
            else reachable_with_tolerance.union(expanded_sweep)
        )
        if circle is not None:
            focus_ends[limb_owners[id(path)]] = (len(result) - 1, circle)
        if index not in terminal_indices or circle is None or ring is None:
            continue
        cap = _forward_ring_segment(
            ring, ring.project(Point(bordered[0])), ring.project(Point(bordered[-1])),
        )
        completion = _finish_scoop_focus(
            cap, circle=circle, component=component, prior=prior,
            maximum_cut_width=maximum_cut_width, chord_tolerance=chord_tolerance,
            coverage_quad_segs=coverage_quad_segs, cut_direction=cut_direction,
        )
        # Another retained focus may own this interval. Defer it to the
        # component's remaining-wall pass rather than emitting a full rim.
        for scoop in completion or []:
            result.append(scoop)
            line = LineString(scoop)
            prior = unary_union([prior, line])
            reachable = reachable.union(
                line.buffer(requested_cut_width, quad_segs=coverage_quad_segs)
            )
            reachable_with_tolerance = reachable_with_tolerance.union(
                line.buffer(
                    requested_cut_width + chord_tolerance,
                    quad_segs=coverage_quad_segs,
                )
            )

    # A root spiral can expose a round cap behind its outgoing limbs. Finish
    # that cap at the root, not after the descendants have been machined.
    for path in paths:
        if id(path) in limb_owners:
            continue
        root_reach = LineString(path).buffer(maximum_cut_width, quad_segs=coverage_quad_segs)
        root_index = next(index for index, item in enumerate(result) if item is path)
        for ring in rings:
            missing = ring.difference(prior.buffer(max(MINIMUM_RADIUS, chord_tolerance * 1e-6)))
            for part in getattr(missing, "geoms", [missing]):
                if part.length <= maximum_cut_width or not root_reach.covers(part):
                    continue
                cap = np.ascontiguousarray(part.coords)
                root_index += 1
                result.insert(root_index, cap)
                result.link_support_radii = {
                    index + (index >= root_index): radii
                    for index, radii in result.link_support_radii.items()
                }
                focus_ends = {
                    owner: (index + (index >= root_index), circle)
                    for owner, (index, circle) in focus_ends.items()
                }
                prior = unary_union([prior, part])

    # Complete remaining wall intervals at a retained focus, using only that
    # prefix's actual cut stock. Never borrow clearance from a future sibling.
    additions: dict[int, list[np.ndarray]] = {}
    for ring in rings:
        missing = ring.difference(prior.buffer(max(MINIMUM_RADIUS, chord_tolerance * 1e-6)))
        for part in getattr(missing, "geoms", [missing]):
            if part.length <= maximum_cut_width:
                continue
            border = np.asarray(part.coords)
            candidates = sorted(focus_ends.values(), key=lambda item: max(
                math.dist(item[1].center, point) - item[1].radius for point in border
            ))
            for end_index, circle in candidates:
                prefix = unary_union([
                    LineString(item)
                    for index, path in enumerate(result[:end_index + 1])
                    for item in (path, *additions.get(index, []))
                ])
                completion = _finish_scoop_focus(
                    border, circle=circle, component=component, prior=prefix,
                    maximum_cut_width=maximum_cut_width, chord_tolerance=chord_tolerance,
                    coverage_quad_segs=coverage_quad_segs, cut_direction=cut_direction,
                )
                if completion is None or any(
                    LineString(item).length < maximum_cut_width for item in completion
                ):
                    continue
                additions.setdefault(end_index, []).extend(completion)
                prior = unary_union([prior, *[LineString(item) for item in completion]])
                break
    if additions:
        expanded = AdaptivePocketLayers()
        for index, path in enumerate(result):
            if index in result.link_support_radii:
                expanded.link_support_radii[len(expanded)] = result.link_support_radii[index]
            expanded.append(path)
            expanded.extend(additions.get(index, []))
        result = expanded

    # Finish a short wall remnant by extending its owning cut, not by
    # emitting an isolated poke or reinstating the entire cleanup ring.
    for ring in rings:
        missing = ring.difference(prior.buffer(max(MINIMUM_RADIUS, chord_tolerance * 1e-6)))
        for part in getattr(missing, "geoms", [missing]):
            if not MINIMUM_RADIUS < part.length <= maximum_cut_width:
                continue
            extension = np.asarray(part.coords)
            if len(extension) < 2 or not safe.covers(part):
                continue
            prefix_reach: BaseGeometry | None = None
            for index, path in enumerate(result):
                if (
                    prefix_reach is not None
                    and prefix_reach.covers(part)
                    and LineString(path).length >= maximum_cut_width
                ):
                    if math.dist(path[-1], extension[0]) <= chord_tolerance * 1e-4:
                        result[index] = np.ascontiguousarray(np.vstack((path, extension[1:])))
                    elif math.dist(path[0], extension[-1]) <= chord_tolerance * 1e-4:
                        result[index] = np.ascontiguousarray(np.vstack((extension[:-1], path)))
                    if result[index] is not path:
                        prior = unary_union([prior, part])
                        break
                sweep = LineString(path).buffer(
                    requested_cut_width, quad_segs=coverage_quad_segs,
                )
                prefix_reach = sweep if prefix_reach is None else prefix_reach.union(sweep)

    coverage = prior.buffer(tool_radius, quad_segs=coverage_quad_segs)
    residual = target_region.difference(coverage)
    # Buffer caps tessellate differently when a wall is split between scoops.
    # Prove coverage of the center-region interior and its entire boundary;
    # the latter's true cutter sweep covers the remaining reachable wall band.
    if not residual.is_empty and (
        not prior.buffer(max(MINIMUM_RADIUS, chord_tolerance * 1e-6)).covers(component.boundary)
        or not coverage.covers(component)
        or not residual.buffer(-chord_tolerance / 4).is_empty
    ):
        return AdaptivePocketLayers(paths + cleanup_paths)
    return result


def _scoop_border_leads(
    path: np.ndarray,
    *,
    circle: MaximalInscribedCircle,
    ring: LineString,
    prior: BaseGeometry,
    safe: BaseGeometry,
    reachable: BaseGeometry,
    reachable_with_tolerance: BaseGeometry,
    previous_contacts: tuple[float, float] | None,
    chord_tolerance: float,
) -> tuple[np.ndarray, tuple[float, float]]:
    start, end = (ring.project(Point(point)) for point in (path[1], path[-2]))
    first, last = previous_contacts or tuple(
        ring.project(Point(point)) for point in (path[0], path[-1])
    )
    reached = ring.intersection(prior)
    stations = [
        ring.project(Point(coordinate))
        for part in getattr(reached, "geoms", [reached])
        for coordinate in part.coords
    ]
    if stations:
        before = min(stations, key=lambda station: (start - station) % ring.length)
        after = min(stations, key=lambda station: (station - end) % ring.length)
        if reachable.covers(LineString(_forward_ring_segment(ring, before, start))):
            first = before
        if reachable.covers(LineString(_forward_ring_segment(ring, end, after))):
            last = after
    lead_in = _forward_ring_segment(ring, first, start)
    lead_out = _forward_ring_segment(ring, end, last)
    arc = path[1:-1]
    allowed = safe.intersection(reachable_with_tolerance)
    incoming = _end_tangent(lead_in)
    outgoing = _start_tangent(lead_out)
    if incoming is None:
        incoming = _end_tangent(_forward_ring_segment(
            ring, (start - chord_tolerance) % ring.length, start,
        ))
    if outgoing is None:
        outgoing = _start_tangent(_forward_ring_segment(
            ring, end, (end + chord_tolerance) % ring.length,
        ))
    if incoming is None or outgoing is None:
        return path, (start, end)
    entry = _tangent_scoop_join(
        lead_in[-1], incoming, arc, circle=circle,
        allowed=allowed, chord_tolerance=chord_tolerance,
    )
    exit_join = _tangent_scoop_join(
        lead_out[0], -outgoing, arc[::-1], circle=circle,
        allowed=allowed, chord_tolerance=chord_tolerance,
    )
    if entry is None or exit_join is None:
        return path, (start, end)
    entry_points, first_arc_index = entry
    exit_points, last_arc_index = exit_join
    candidate = np.vstack((
        lead_in, entry_points[1:], arc[first_arc_index + 1:len(arc) - last_arc_index],
        exit_points[-2::-1], lead_out[1:],
    ))
    candidate = candidate[np.r_[True, np.linalg.norm(np.diff(candidate, axis=0), axis=1) > MINIMUM_RADIUS]]
    # A backwards projection would wrap around the pocket. Reject it rather
    # than replacing a local lead with a rim pass or reversing wall direction.
    if (
        LineString(lead_in).length <= LineString(path).length
        and LineString(lead_out).length <= LineString(path).length
        and safe.covers(LineString(candidate))
        and reachable_with_tolerance.covers(LineString(candidate))
    ):
        return np.ascontiguousarray(candidate), (start, end)
    return path, (start, end)


def _tangent_scoop_join(
    start: np.ndarray,
    tangent: np.ndarray,
    arc: np.ndarray,
    *,
    circle: MaximalInscribedCircle,
    allowed: BaseGeometry,
    chord_tolerance: float,
) -> tuple[np.ndarray, int] | None:
    """Trim a scoop and meet its circle and the wall with matching tangents."""
    if np.linalg.norm(start - arc[0]) <= MINIMUM_RADIUS:
        return arc[:1], 0
    radial = arc[:2] - np.asarray(circle.center)
    direction = np.sign(radial[0, 0] * radial[1, 1] - radial[0, 1] * radial[1, 0])
    for index in range(1, max(2, len(arc) // 3)):
        end = arc[index]
        radius = end - np.asarray(circle.center)
        end_tangent = direction * np.asarray((-radius[1], radius[0])) / np.linalg.norm(radius)
        chord = end - start
        distance = float(np.linalg.norm(chord))
        if np.dot(chord, tangent) <= 0 or np.dot(chord, end_tangent) <= 0:
            continue
        for scale in (1 / 3, 0.25, 0.5):
            controls = np.asarray((
                start, start + scale * distance * tangent,
                end - scale * distance * end_tangent, end,
            ))
            # Nondecreasing control-polygon projections prohibit backwards
            # hooks. Collision sampling is finer than emitted CL tessellation.
            if np.any(np.diff(controls, axis=0) @ chord < -MINIMUM_RADIUS):
                continue
            collision_points = _sample_cubic_join(
                controls, chord_tolerance=min(chord_tolerance / 1000, 1e-5),
            )
            if not allowed.covers(LineString(collision_points)):
                continue
            points = _sample_cubic_join(controls, chord_tolerance=chord_tolerance / 4)
            if allowed.covers(LineString(points)):
                return points, index
    return None


def _sample_cubic_join(controls: np.ndarray, *, chord_tolerance: float) -> np.ndarray:
    """Tessellate a tangent cubic using its control-hull chord-error bound."""
    points = [controls[0]]
    pending = [controls]
    while pending:
        curve = pending.pop()
        chord = curve[-1] - curve[0]
        length_squared = float(np.dot(chord, chord))
        if length_squared <= MINIMUM_RADIUS**2:
            flatness = float(np.max(np.linalg.norm(curve - curve[0], axis=1)))
        else:
            fractions = np.clip((curve[1:3] - curve[0]) @ chord / length_squared, 0, 1)
            projections = curve[0] + fractions[:, None] * chord
            flatness = float(np.max(np.linalg.norm(curve[1:3] - projections, axis=1)))
        tangents = np.asarray((curve[1] - curve[0], curve[3] - curve[2]))
        tangent_lengths = np.linalg.norm(tangents, axis=1)
        aligned = length_squared <= MINIMUM_RADIUS**2 or bool(np.all(
            tangents @ chord >= math.cos(MAX_BLEND_TANGENT_STEP) * tangent_lengths * math.sqrt(length_squared)
        ))
        if flatness <= chord_tolerance and aligned:
            points.append(curve[-1])
            continue
        middle = (curve[:-1] + curve[1:]) / 2
        inner = (middle[:-1] + middle[1:]) / 2
        split = (inner[0] + inner[1]) / 2
        pending.append(np.asarray((split, inner[1], middle[2], curve[3])))
        pending.append(np.asarray((curve[0], middle[0], inner[0], split)))
    return np.ascontiguousarray(points)


def _finish_scoop_focus(
    border: np.ndarray,
    *,
    circle: MaximalInscribedCircle,
    component: Polygon,
    prior: BaseGeometry,
    maximum_cut_width: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
) -> list[np.ndarray] | None:
    """Grow the last scoop front until its local border is within stepover."""
    border_line = LineString(border)
    radius = circle.radius
    final_radius = max(math.dist(circle.center, point) for point in border)
    minimum_increment = maximum_cut_width / 8
    count = max(1, math.ceil(max(0, final_radius - radius) / minimum_increment) + 4)
    result: list[np.ndarray] = []
    for _ in range(count):
        reachable = prior.buffer(maximum_cut_width, quad_segs=coverage_quad_segs)
        if reachable.covers(border_line):
            result.append(border)
            return result
        # Long concave wall intervals may not be reachable in one radial
        # step. Subdivide the same focus front; never cut an unreachable arc.
        for fraction in (1, 0.5, 0.25, 0.125):
            next_radius = radius + maximum_cut_width * fraction
            disk = Point(circle.center).buffer(
                next_radius,
                quad_segs=quad_segs_for_tolerance(next_radius, chord_tolerance / 4),
            )
            clipped = component.intersection(disk)
            if not isinstance(clipped, Polygon):
                continue
            ring = LineString(orient(
                clipped, sign=1 if cut_direction == "climb" else -1,
            ).exterior.coords)
            scoop = _forward_ring_segment(
                ring, ring.project(Point(border[0])), ring.project(Point(border[-1])),
            )
            line = LineString(scoop)
            if line.length <= MINIMUM_RADIUS or not reachable.buffer(chord_tolerance).covers(line):
                continue
            result.append(scoop)
            prior = unary_union([prior, line])
            radius = next_radius
            break
        else:
            return None
    return None


def _forward_ring_segment(ring: LineString, first: float, last: float) -> np.ndarray:
    if last >= first:
        points = np.asarray(substring(ring, first, last).coords, dtype=np.float64)
        return points if len(points) > 1 else np.repeat(points, 2, axis=0)
    return np.vstack(
        (
            np.asarray(substring(ring, first, ring.length).coords, dtype=np.float64),
            np.asarray(substring(ring, 0, last).coords, dtype=np.float64)[1:],
        )
    )


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

    tolerance_region = component.buffer(max(chord_tolerance * 1e-6, MINIMUM_RADIUS))
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
            if not component.covers(Point(center)):
                continue
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
) -> LimbScoopPaths:
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
    paths = LimbScoopPaths()
    node_owners: dict[int, int] = {}
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
        scoops = []
        branch = LineString([circle.center for circle in circles])
        safe = component.buffer(max(chord_tolerance * 1e-6, MINIMUM_RADIUS))
        for first, second in transitions:
            for scoop, front, circle in _safe_scoop_transition(
                first, second, branch=branch, component=component, safe=safe,
                maximum_cut_width=maximum_cut_width,
                chord_tolerance=chord_tolerance, coverage_quad_segs=coverage_quad_segs,
                cut_direction=cut_direction,
            ):
                scoops.append(scoop)
                paths.circles[id(scoop)] = circle
                paths.fronts[id(scoop)] = front
        spiral = _round_branch_spiral(
            circles,
            scoops,
            maximum_cut_width=maximum_cut_width,
            chord_tolerance=chord_tolerance,
            tool_radius=tool_radius,
            coverage_tolerance=coverage_tolerance,
            coverage_quad_segs=coverage_quad_segs,
            cut_direction=cut_direction,
        )
        branch_paths = [spiral] if spiral is not None else scoops
        if branch_paths:
            owner = id(branch_paths[0])
            paths.limb_parents[owner] = node_owners.get(branch_start_id)
            node_owners[current_id] = owner
            for path in branch_paths:
                paths.limb_owners[id(path)] = owner
        elif branch_start_id in node_owners:
            node_owners[current_id] = node_owners[branch_start_id]
        paths.extend(branch_paths)

        pending.extend(
            (current_id, child_id)
            for child_id in reversed(list(tree.successors(current_id)))
        )

    return paths


def _safe_scoop_transition(
    first: MaximalInscribedCircle,
    second: MaximalInscribedCircle,
    *,
    branch: LineString,
    component: Polygon,
    safe: BaseGeometry,
    maximum_cut_width: float,
    chord_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
    depth: int = 0,
) -> list[tuple[np.ndarray, np.ndarray, MaximalInscribedCircle]]:
    """Construct legal cuts; MIC containment alone does not validate bitangents."""
    raw = _scoop_path(first, second, chord_tolerance=chord_tolerance)
    if len(raw) < 2:
        return []
    if cut_direction == "conventional":
        raw = np.ascontiguousarray(raw[::-1])
    if safe.covers(LineString(raw)):
        return [(raw, raw, second)]

    # Interpolate along the actual branch, not a chord across several medial
    # edges. Recompute clearance against the original boundary at each center.
    middle = None
    if depth < MAX_SCOOP_REFINEMENT:
        begin = branch.project(Point(first.center))
        end = branch.project(Point(second.center))
        if end - begin > MINIMUM_RADIUS:
            point = branch.interpolate((begin + end) / 2)
            if component.covers(point):
                middle = MaximalInscribedCircle(
                    (point.x, point.y), component.boundary.distance(point),
                )
    if middle is not None:
        pairs = ((first, middle), (middle, second))
        refined = [
            _scoop_path(a, b, chord_tolerance=chord_tolerance) for a, b in pairs
        ]
        if all(
            len(path) >= 2 and safe.covers(LineString(path))
            and _cut_width(a, b) <= maximum_cut_width + chord_tolerance
            for path, (a, b) in zip(refined, pairs)
        ):
            if cut_direction == "conventional":
                refined = [np.ascontiguousarray(path[::-1]) for path in refined]
            return [(path, path, b) for path, (_, b) in zip(refined, pairs)]

    # Replace the unsafe straight flanks with oriented local offset-boundary
    # leads. Keep the inscribed-circle arc; do not clip a cutter path into bits.
    rings = [LineString(path) for path in _boundary_cleanup_paths(
        component, cut_direction=cut_direction,
    )]
    ring = min(rings, key=lambda boundary: max(
        boundary.distance(Point(point)) for point in (raw[1], raw[-2])
    ))
    prior = LineString(_sample_arc(
        center=first.center, radius=first.radius, start_angle=0,
        sweep_angle=math.tau, chord_tolerance=chord_tolerance / 4,
    ))
    reachable = prior.buffer(maximum_cut_width, quad_segs=coverage_quad_segs)
    rebuilt, _ = _scoop_border_leads(
        raw, circle=second, ring=ring, prior=prior, safe=safe,
        reachable=reachable,
        reachable_with_tolerance=prior.buffer(
            maximum_cut_width + chord_tolerance, quad_segs=coverage_quad_segs,
        ), previous_contacts=None, chord_tolerance=chord_tolerance,
    )
    if safe.covers(LineString(rebuilt)):
        return [(rebuilt, raw, second)]
    if middle is not None and all(
        _cut_width(a, b) <= maximum_cut_width + chord_tolerance
        for a, b in ((first, middle), (middle, second))
    ):
        return [
            item
            for a, b in ((first, middle), (middle, second))
            for item in _safe_scoop_transition(
                a, b, branch=branch, component=component, safe=safe,
                maximum_cut_width=maximum_cut_width, chord_tolerance=chord_tolerance,
                coverage_quad_segs=coverage_quad_segs, cut_direction=cut_direction,
                depth=depth + 1,
            )
        ]

    # A clearance-disk arc is legal even when no in-bounds tangent flank
    # exists. Leave wall completion to the local planner and let the link
    # builder choose a contained transfer or clearance, never an unsafe flank.
    arc = np.ascontiguousarray(raw[1:-1])
    if len(arc) < 2 or not safe.covers(LineString(arc)):
        raise ValueError("Adaptive pocketing cannot construct an in-bounds scoop.")
    return [(arc, raw, second)]


def _round_branch_spiral(
    circles: list[MaximalInscribedCircle],
    scoops: list[np.ndarray],
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    tool_radius: float,
    coverage_tolerance: float,
    coverage_quad_segs: int,
    cut_direction: Literal["climb", "conventional"],
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
        cut_direction=cut_direction,
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


def _spiral_path_parts(
    circle: MaximalInscribedCircle,
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    cut_direction: Literal["climb", "conventional"] = "climb",
) -> tuple[np.ndarray, np.ndarray]:
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
    return spiral, outer_circle


def _spiral_path(
    circle: MaximalInscribedCircle,
    *,
    maximum_cut_width: float,
    chord_tolerance: float,
    cut_direction: Literal["climb", "conventional"] = "climb",
) -> np.ndarray:
    spiral, outer_circle = _spiral_path_parts(
        circle,
        maximum_cut_width=maximum_cut_width,
        chord_tolerance=chord_tolerance,
        cut_direction=cut_direction,
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
