from __future__ import annotations

import numpy as np
from shapely.geometry import Polygon

from opencam.engine.closed_polyline.offset import DEFAULT_BUFFER_CHORD_TOLERANCE, offset
from opencam.engine.pocketing.models import PocketTreeNode


def build_ordered_pocket_nodes(
    base_polyline: np.ndarray,
    *,
    tool_diameter: float,
    stepover_percent: float,
    stock_to_leave: float,
    chord_tolerance: float = DEFAULT_BUFFER_CHORD_TOLERANCE,
) -> list[PocketTreeNode]:
    node_layers = build_offset_node_layers(
        base_polyline,
        tool_diameter=tool_diameter,
        stepover_percent=stepover_percent,
        stock_to_leave=stock_to_leave,
        chord_tolerance=chord_tolerance,
    )
    if not node_layers:
        return []

    roots = build_tree(node_layers)
    ordered_nodes: list[PocketTreeNode] = []
    for root in sorted(roots, key=node_sort_key):
        ordered_nodes.extend(depth_first_postorder(root))

    return ordered_nodes


def build_offset_node_layers(
    base_polyline: np.ndarray,
    *,
    tool_diameter: float,
    stepover_percent: float,
    stock_to_leave: float,
    chord_tolerance: float = DEFAULT_BUFFER_CHORD_TOLERANCE,
) -> list[list[PocketTreeNode]]:
    first_offset_distance = tool_diameter / 2 + stock_to_leave
    stepover_distance = tool_diameter * (stepover_percent / 100)
    offset_distance = first_offset_distance
    node_layers: list[list[PocketTreeNode]] = []

    while True:
        polylines = offset(
            base_polyline,
            -offset_distance,
            chord_tolerance=chord_tolerance,
        )
        if not polylines:
            break

        layer = [
            PocketTreeNode(
                polyline=polyline,
                polygon=Polygon(polyline),
            )
            for polyline in polylines
        ]
        layer.sort(key=node_sort_key)
        node_layers.append(layer)
        offset_distance += stepover_distance

    return node_layers


def build_tree(node_layers: list[list[PocketTreeNode]]) -> list[PocketTreeNode]:
    for depth_index in range(1, len(node_layers)):
        parent_nodes = node_layers[depth_index - 1]
        child_nodes = node_layers[depth_index]

        for child_node in child_nodes:
            parent_node = find_parent_node(parent_nodes, child_node)
            if parent_node is not None:
                child_node.parent = parent_node
                parent_node.children.append(child_node)

    for node_layer in node_layers:
        for node in node_layer:
            node.children.sort(key=node_sort_key)

    return node_layers[0]


def find_parent_node(
    parent_nodes: list[PocketTreeNode],
    child_node: PocketTreeNode,
) -> PocketTreeNode | None:
    child_point = child_node.polygon.representative_point()

    for tolerance in (1e-9, 1e-6, 1e-4):
        for parent_node in parent_nodes:
            if parent_node.polygon.buffer(tolerance).covers(child_point):
                return parent_node

    if not parent_nodes:
        return None

    return min(
        parent_nodes,
        key=lambda parent_node: parent_node.polygon.distance(child_node.polygon),
    )


def depth_first_postorder(node: PocketTreeNode) -> list[PocketTreeNode]:
    ordered_nodes: list[PocketTreeNode] = []

    for child in node.children:
        ordered_nodes.extend(depth_first_postorder(child))

    ordered_nodes.append(node)
    return ordered_nodes


def polygon_sort_key(polygon: Polygon) -> tuple[float, float, float]:
    point = polygon.representative_point()
    return (round(point.x, 6), round(point.y, 6), -polygon.area)


def node_sort_key(node: PocketTreeNode) -> tuple[float, float, float]:
    return polygon_sort_key(node.polygon)
