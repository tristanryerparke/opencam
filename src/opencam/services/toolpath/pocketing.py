from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Literal

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.schemas.models import ClosedPolyline, CutterLocationData, Path
from opencam.services.toolpath.base import BaseOperation


Coordinate2D = tuple[float, float]


@dataclass
class PocketTreeNode:
    polygon: Polygon
    parent: PocketTreeNode | None = None
    children: list["PocketTreeNode"] = field(default_factory=list)


class ClosedPocketingEngine(BaseOperation):
    ring: ClosedPolyline
    z_bounds: tuple[float, float]
    z_step_height: float
    stepover: float = 25.0
    stock_to_leave: float = 0
    seam_policy: Literal["fusion_like", "nearest_vertex"] = "fusion_like"

    def process(self) -> list[Path]:
        if self.stepover <= 0:
            raise ValueError("Stepover must be greater than 0%.")
        if self.stepover > 100:
            raise ValueError("Stepover must be 100% or less.")

        base_polygon = Polygon(self.ring.to_shapely())
        layer_heights = self.compute_layer_heights(
            self.z_bounds,
            self.z_step_height,
        )

        ordered_nodes = self.build_ordered_pocket_nodes(base_polygon)
        if not ordered_nodes:
            raise ValueError(
                "Pocketing geometry is too small for the selected tool diameter and stock to leave."
            )

        pocket_center = self.polygon_center(base_polygon)
        cut_paths: list[Path] = []
        for layer_index, height in enumerate(layer_heights, start=1):
            cut_paths.extend(
                self.build_layer_cut_paths(
                    ordered_nodes,
                    height,
                    layer_index,
                    pocket_center=pocket_center,
                )
            )

        return self.build_cut_path_sequence(cut_paths)

    def build_ordered_pocket_nodes(self, base_polygon: Polygon) -> list[PocketTreeNode]:
        layers = self.build_offset_layers(base_polygon)
        if not layers:
            return []

        roots = self.build_tree(layers)
        ordered_nodes: list[PocketTreeNode] = []
        for root in sorted(roots, key=self.node_sort_key):
            ordered_nodes.extend(self.depth_first_postorder(root))

        return ordered_nodes

    def build_layer_cut_paths(
        self,
        ordered_nodes: list[PocketTreeNode],
        z_height: float,
        layer_index: int,
        *,
        pocket_center: Coordinate2D,
    ) -> list[Path]:
        if self.seam_policy == "nearest_vertex":
            return self.build_layer_cut_paths_nearest_vertex(
                ordered_nodes,
                z_height,
                layer_index,
            )

        cut_paths: list[Path] = []
        current_locations: list[CutterLocationData] = []
        current_node: PocketTreeNode | None = None
        branch_index = 1

        for node in ordered_nodes:
            connects_directly = current_node is not None and self.can_connect_directly(
                current_node,
                node,
            )

            if current_locations and not connects_directly:
                cut_paths.append(
                    Path(
                        name=f"Pocket path L{layer_index} B{branch_index}",
                        kind="cut",
                        locations=self.dedupe_locations(current_locations),
                    )
                )
                branch_index += 1
                current_locations = []
                current_node = None

            ring_locations = self.polygon_to_locations(
                node.polygon,
                z_height,
                start_reference=current_locations[-1] if current_locations else None,
                is_branch_start=not current_locations,
                pocket_center=pocket_center,
            )
            if not ring_locations:
                continue

            if not current_locations:
                current_locations = ring_locations
                current_node = node
                continue

            current_locations = self.dedupe_locations([
                *current_locations,
                *ring_locations,
            ])
            current_node = node

        if current_locations:
            cut_paths.append(
                Path(
                    name=f"Pocket path L{layer_index} B{branch_index}",
                    kind="cut",
                    locations=self.dedupe_locations(current_locations),
                )
            )

        return cut_paths

    def build_layer_cut_paths_nearest_vertex(
        self,
        ordered_nodes: list[PocketTreeNode],
        z_height: float,
        layer_index: int,
    ) -> list[Path]:
        cut_paths: list[Path] = []
        current_locations: list[CutterLocationData] = []
        current_node: PocketTreeNode | None = None
        branch_index = 1

        for node in ordered_nodes:
            ring_locations = self.polygon_to_locations(
                node.polygon,
                z_height,
                start_reference=current_locations[-1] if current_locations else None,
            )
            if not ring_locations:
                continue

            if not current_locations:
                current_locations = ring_locations
                current_node = node
                continue

            if current_node is not None and self.can_connect_directly(current_node, node):
                current_locations = self.dedupe_locations([
                    *current_locations,
                    *ring_locations,
                ])
            else:
                cut_paths.append(
                    Path(
                        name=f"Pocket path L{layer_index} B{branch_index}",
                        kind="cut",
                        locations=self.dedupe_locations(current_locations),
                    )
                )
                branch_index += 1
                current_locations = ring_locations

            current_node = node

        if current_locations:
            cut_paths.append(
                Path(
                    name=f"Pocket path L{layer_index} B{branch_index}",
                    kind="cut",
                    locations=self.dedupe_locations(current_locations),
                )
            )

        return cut_paths

    def can_connect_directly(
        self,
        current_node: PocketTreeNode,
        next_node: PocketTreeNode,
    ) -> bool:
        return self.is_ancestor(next_node, current_node)

    def is_ancestor(
        self,
        potential_ancestor: PocketTreeNode,
        node: PocketTreeNode,
    ) -> bool:
        current = node.parent
        while current is not None:
            if current is potential_ancestor:
                return True
            current = current.parent

        return False

    def build_offset_layers(self, base_polygon: Polygon) -> list[list[Polygon]]:
        first_offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        stepover_distance = self.tool.diameter * (self.stepover / 100)
        offset_distance = first_offset_distance
        layers: list[list[Polygon]] = []

        while True:
            offset_geometry = base_polygon.buffer(-offset_distance, quad_segs=32)
            polygons = self.extract_polygons(offset_geometry)
            if not polygons:
                break

            layers.append(sorted(polygons, key=self.polygon_sort_key))
            offset_distance += stepover_distance

        return layers

    def build_tree(self, layers: list[list[Polygon]]) -> list[PocketTreeNode]:
        node_layers = [
            [PocketTreeNode(polygon=polygon) for polygon in polygons]
            for polygons in layers
        ]

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

    def polygon_to_locations(
        self,
        polygon: Polygon,
        z_height: float,
        *,
        start_reference: CutterLocationData | None = None,
        is_branch_start: bool = False,
        pocket_center: Coordinate2D | None = None,
    ) -> list[CutterLocationData]:
        ring_coordinates = [(float(x), float(y)) for x, y in polygon.exterior.coords[:-1]]
        if not ring_coordinates:
            return []

        if (
            self.seam_policy == "fusion_like"
            and is_branch_start
            and pocket_center is not None
        ):
            ring_coordinates = self.fusion_like_ring_coordinates(
                ring_coordinates,
                polygon=polygon,
                pocket_center=pocket_center,
            )
        elif start_reference is not None:
            start_index = min(
                range(len(ring_coordinates)),
                key=lambda index: (ring_coordinates[index][0] - start_reference.x) ** 2
                + (ring_coordinates[index][1] - start_reference.y) ** 2,
            )
            ring_coordinates = self.oriented_ring(ring_coordinates, start_index)

        ring_coordinates.append(ring_coordinates[0])

        return [
            CutterLocationData(x=x, y=y, z=z_height)
            for x, y in ring_coordinates
        ]

    def fusion_like_ring_coordinates(
        self,
        ring_coordinates: list[Coordinate2D],
        *,
        polygon: Polygon,
        pocket_center: Coordinate2D,
    ) -> list[Coordinate2D]:
        if len(ring_coordinates) < 2:
            return ring_coordinates

        if self.is_positive_side_branch(polygon, pocket_center):
            return self.midpoint_entry_ring_coordinates(ring_coordinates)

        return self.corner_offset_entry_ring_coordinates(ring_coordinates)

    def is_positive_side_branch(
        self,
        polygon: Polygon,
        pocket_center: Coordinate2D,
    ) -> bool:
        point = polygon.representative_point()
        dx = point.x - pocket_center[0]
        dy = point.y - pocket_center[1]

        if math.isclose(dx, 0.0, abs_tol=1e-9) and math.isclose(dy, 0.0, abs_tol=1e-9):
            return True

        if abs(dx) >= abs(dy):
            return dx >= 0

        return dy >= 0

    def midpoint_entry_ring_coordinates(
        self,
        ring_coordinates: list[Coordinate2D],
    ) -> list[Coordinate2D]:
        if len(ring_coordinates) < 2:
            return ring_coordinates

        edge_lengths = self.closed_edge_lengths(ring_coordinates)
        shortest_edge_index = min(range(len(edge_lengths)), key=edge_lengths.__getitem__)
        start_index = shortest_edge_index
        step = -1

        end_index = (shortest_edge_index + 1) % len(ring_coordinates)
        if end_index <= start_index:
            start_index = end_index
            step = 1

        oriented_coordinates = self.oriented_ring(
            ring_coordinates,
            start_index,
            step=step,
        )
        return self.split_ring_on_previous_edge(
            oriented_coordinates,
            edge_lengths[shortest_edge_index] / 2,
        )

    def corner_offset_entry_ring_coordinates(
        self,
        ring_coordinates: list[Coordinate2D],
    ) -> list[Coordinate2D]:
        if len(ring_coordinates) < 2:
            return ring_coordinates

        raw_previous_length = self.edge_length(ring_coordinates[-1], ring_coordinates[0])
        raw_next_length = self.edge_length(ring_coordinates[0], ring_coordinates[1])
        step = 1 if raw_previous_length >= raw_next_length else -1
        oriented_coordinates = self.oriented_ring(ring_coordinates, 0, step=step)

        previous_length = self.edge_length(
            oriented_coordinates[-1],
            oriented_coordinates[0],
        )
        next_length = self.edge_length(
            oriented_coordinates[0],
            oriented_coordinates[1],
        )
        shortest_length = min(self.closed_edge_lengths(oriented_coordinates))

        if (
            math.isclose(previous_length, next_length, rel_tol=1e-9, abs_tol=1e-9)
            and previous_length > shortest_length
        ):
            distance_from_current = previous_length - shortest_length / 2
        else:
            distance_from_current = shortest_length / 2

        return self.split_ring_on_previous_edge(
            oriented_coordinates,
            distance_from_current,
        )

    def oriented_ring(
        self,
        ring_coordinates: list[Coordinate2D],
        start_index: int,
        *,
        step: int = 1,
    ) -> list[Coordinate2D]:
        if not ring_coordinates:
            return []

        count = len(ring_coordinates)
        return [
            ring_coordinates[(start_index + step * offset) % count]
            for offset in range(count)
        ]

    def split_ring_on_previous_edge(
        self,
        ring_coordinates: list[Coordinate2D],
        distance_from_current: float,
    ) -> list[Coordinate2D]:
        if len(ring_coordinates) < 2:
            return ring_coordinates

        previous_point = ring_coordinates[-1]
        current_point = ring_coordinates[0]
        previous_edge_length = self.edge_length(previous_point, current_point)
        if previous_edge_length <= 0:
            return ring_coordinates

        clamped_distance = max(0.0, min(distance_from_current, previous_edge_length))
        fraction = 1 - clamped_distance / previous_edge_length
        seam_point = self.interpolate_point(previous_point, current_point, fraction)

        return [seam_point, *ring_coordinates]

    def polygon_center(self, polygon: Polygon) -> Coordinate2D:
        min_x, min_y, max_x, max_y = polygon.bounds
        return ((min_x + max_x) / 2, (min_y + max_y) / 2)

    def closed_edge_lengths(
        self,
        ring_coordinates: list[Coordinate2D],
    ) -> list[float]:
        if len(ring_coordinates) < 2:
            return []

        return [
            self.edge_length(
                ring_coordinates[index],
                ring_coordinates[(index + 1) % len(ring_coordinates)],
            )
            for index in range(len(ring_coordinates))
        ]

    def edge_length(
        self,
        start: Coordinate2D,
        end: Coordinate2D,
    ) -> float:
        return math.hypot(end[0] - start[0], end[1] - start[1])

    def interpolate_point(
        self,
        start: Coordinate2D,
        end: Coordinate2D,
        fraction: float,
    ) -> Coordinate2D:
        return (
            start[0] + (end[0] - start[0]) * fraction,
            start[1] + (end[1] - start[1]) * fraction,
        )

    def extract_polygons(self, geometry: BaseGeometry) -> list[Polygon]:
        if geometry.is_empty:
            return []
        if isinstance(geometry, Polygon):
            return [geometry] if geometry.area > 0 else []
        if isinstance(geometry, MultiPolygon):
            return [polygon for polygon in geometry.geoms if polygon.area > 0]
        if isinstance(geometry, GeometryCollection):
            polygons: list[Polygon] = []
            for child_geometry in geometry.geoms:
                polygons.extend(self.extract_polygons(child_geometry))
            return polygons

        return []

    def polygon_sort_key(self, polygon: Polygon) -> tuple[float, float, float]:
        point = polygon.representative_point()
        return (round(point.x, 6), round(point.y, 6), -polygon.area)

    def node_sort_key(self, node: PocketTreeNode) -> tuple[float, float, float]:
        return self.polygon_sort_key(node.polygon)
