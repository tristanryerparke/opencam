from __future__ import annotations

import numpy as np
from shapely.geometry import Polygon

import opencam.engine.closed_polyline as cp
from opencam.services.operations.pocketing.models import PocketTreeNode


class PocketTreeMixin:
    def build_ordered_pocket_nodes(self, base_polyline: np.ndarray) -> list[PocketTreeNode]:
        layers = self.build_offset_layers(base_polyline)
        if not layers:
            return []

        roots = self.build_tree(layers)
        ordered_nodes: list[PocketTreeNode] = []
        for root in sorted(roots, key=self.node_sort_key):
            ordered_nodes.extend(self.depth_first_postorder(root))

        return ordered_nodes

    def build_offset_layers(self, base_polyline: np.ndarray) -> list[list[PocketTreeNode]]:
        first_offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        stepover_distance = self.tool.diameter * (self.stepover / 100)
        offset_distance = first_offset_distance
        layers: list[list[PocketTreeNode]] = []

        while True:
            polylines = cp.offset(
                base_polyline,
                -offset_distance,
            )
            if not polylines:
                break

            node_layer = [
                PocketTreeNode(
                    polyline=polyline,
                    polygon=Polygon(polyline),
                )
                for polyline in polylines
            ]
            node_layer.sort(key=self.node_sort_key)
            layers.append(node_layer)
            offset_distance += stepover_distance

        return layers

    def build_tree(self, node_layers: list[list[PocketTreeNode]]) -> list[PocketTreeNode]:
        for depth_index in range(1, len(node_layers)):
            parent_nodes = node_layers[depth_index - 1]
            child_nodes = node_layers[depth_index]

            for child_node in child_nodes:
                parent_node = self.find_parent_node(parent_nodes, child_node)
                if parent_node is not None:
                    child_node.parent = parent_node
                    parent_node.children.append(child_node)

        for node_layer in node_layers:
            for node in node_layer:
                node.children.sort(key=self.node_sort_key)

        return node_layers[0]

    def find_parent_node(
        self,
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

    def depth_first_postorder(self, node: PocketTreeNode) -> list[PocketTreeNode]:
        ordered_nodes: list[PocketTreeNode] = []

        for child in node.children:
            ordered_nodes.extend(self.depth_first_postorder(child))

        ordered_nodes.append(node)
        return ordered_nodes

    def polygon_sort_key(self, polygon: Polygon) -> tuple[float, float, float]:
        point = polygon.representative_point()
        return (round(point.x, 6), round(point.y, 6), -polygon.area)

    def node_sort_key(self, node: PocketTreeNode) -> tuple[float, float, float]:
        return self.polygon_sort_key(node.polygon)
