from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Polygon

from opencam.engine.closed_polyline.seam_shift import seam_shift
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.engine.pocketing.geometry import polygon_center
from opencam.engine.pocketing.models import Coordinate2D, PocketTreeNode
from opencam.engine.pocketing.seams import (
    branch_side_midpoint_length,
    longest_straight_edge_midpoint_length_near_initial_seam,
    nearest_point_on_longest_straight_edge_length,
    nearest_point_on_ring_length,
)
from opencam.engine.pocketing.tree import build_ordered_pocket_nodes


def build_pocket_layers(
    polyline: np.ndarray,
    *,
    tool_diameter: float,
    stepover_percent: float,
    stock_to_leave: float,
    chord_tolerance: float,
) -> list[np.ndarray]:
    if not 0 < stepover_percent <= 100:
        raise ValueError("Stepover must be greater than 0% and no more than 100%.")

    base_polyline = validate_closed_polyline(polyline)
    base_polyline = seam_shift(
        base_polyline,
        longest_straight_edge_midpoint_length_near_initial_seam(base_polyline),
    )
    ordered_nodes = build_ordered_pocket_nodes(
        base_polyline,
        tool_diameter=tool_diameter,
        stepover_percent=stepover_percent,
        stock_to_leave=stock_to_leave,
        chord_tolerance=chord_tolerance,
    )
    if not ordered_nodes:
        return []

    return build_node_layers(
        ordered_nodes,
        pocket_center=polygon_center(Polygon(base_polyline)),
    )


def build_node_layers(
    ordered_nodes: list[PocketTreeNode],
    *,
    pocket_center: Coordinate2D,
) -> list[np.ndarray]:
    layers: list[np.ndarray] = []
    current_coordinates: np.ndarray | None = None
    current_node: PocketTreeNode | None = None
    current_branch_side_vector: Coordinate2D | None = None
    current_branch_seam_guide: Coordinate2D | None = None

    for node in ordered_nodes:
        connects_directly = current_node is not None and can_connect_directly(
            current_node,
            node,
        )

        if current_coordinates is not None and not connects_directly:
            layers.append(np.ascontiguousarray(current_coordinates))
            current_coordinates = None
            current_node = None
            current_branch_side_vector = None
            current_branch_seam_guide = None

        if current_coordinates is None:
            current_branch_side_vector = compute_branch_side_vector(
                node,
                pocket_center,
            )

        layer_coordinates = node_to_layer_polyline(
            node,
            start_reference=last_coordinate(current_coordinates),
            is_branch_start=current_coordinates is None,
            branch_side_vector=current_branch_side_vector,
            pocket_center=pocket_center,
            seam_guide_reference=current_branch_seam_guide,
        )
        if layer_coordinates.shape[0] == 0:
            continue

        if current_coordinates is None:
            current_branch_seam_guide = last_coordinate(layer_coordinates)
            current_coordinates = layer_coordinates
            current_node = node
            continue

        current_coordinates = append_coordinates(
            current_coordinates,
            layer_coordinates,
        )
        current_node = node

    if current_coordinates is not None:
        layers.append(np.ascontiguousarray(current_coordinates))

    return layers


def can_connect_directly(
    current_node: PocketTreeNode,
    next_node: PocketTreeNode,
) -> bool:
    return is_ancestor(next_node, current_node)


def is_ancestor(
    potential_ancestor: PocketTreeNode,
    node: PocketTreeNode,
) -> bool:
    current = node.parent
    while current is not None:
        if current is potential_ancestor:
            return True
        current = current.parent

    return False


def node_to_layer_polyline(
    node: PocketTreeNode,
    *,
    start_reference: Coordinate2D | None = None,
    is_branch_start: bool = False,
    branch_side_vector: Coordinate2D | None = None,
    pocket_center: Coordinate2D | None = None,
    seam_guide_reference: Coordinate2D | None = None,
) -> np.ndarray:
    polyline = node.polyline
    if polyline.shape[0] == 0:
        return polyline

    if branch_side_vector is not None and pocket_center is not None:
        if is_branch_start:
            return seam_shift(
                polyline,
                branch_side_midpoint_length(
                    polyline,
                    branch_side_vector,
                    pocket_center,
                ),
            )

        reference = seam_guide_reference or start_reference
        if reference is not None:
            return seam_shift(
                polyline,
                nearest_point_on_ring_length(
                    polyline,
                    reference,
                    branch_side_vector=branch_side_vector,
                    pocket_center=pocket_center,
                ),
            )

    if is_branch_start:
        return seam_shift(
            polyline,
            longest_straight_edge_midpoint_length_near_initial_seam(polyline),
        )

    if start_reference is not None:
        return seam_shift(
            polyline,
            nearest_point_on_longest_straight_edge_length(
                polyline,
                start_reference,
            ),
        )

    return polyline


def compute_branch_side_vector(
    node: PocketTreeNode,
    pocket_center: Coordinate2D,
) -> Coordinate2D | None:
    branch_point = node.polygon.representative_point()
    outward_x = float(branch_point.x - pocket_center[0])
    outward_y = float(branch_point.y - pocket_center[1])
    outward_length = math.hypot(outward_x, outward_y)
    if outward_length <= 1e-9:
        return None

    return (
        outward_y / outward_length,
        -outward_x / outward_length,
    )


def append_coordinates(
    current: np.ndarray,
    addition: np.ndarray,
) -> np.ndarray:
    if current.shape[0] == 0:
        return addition
    if addition.shape[0] == 0:
        return current
    if np.array_equal(current[-1], addition[0]):
        return np.vstack((current, addition[1:]))
    return np.vstack((current, addition))


def last_coordinate(coordinates: np.ndarray | None) -> Coordinate2D | None:
    if coordinates is None or coordinates.shape[0] == 0:
        return None
    return (float(coordinates[-1, 0]), float(coordinates[-1, 1]))
