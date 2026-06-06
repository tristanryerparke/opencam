from __future__ import annotations

from dataclasses import dataclass, field

from shapely.geometry import GeometryCollection, MultiPolygon, Polygon
from shapely.geometry.base import BaseGeometry

from opencam.schemas.models import ClosedPolyline, CutterLocationData, Path
from opencam.services.toolpath.base import BaseOperation


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

        cut_paths: list[Path] = []
        for layer_index, height in enumerate(layer_heights, start=1):
            cut_paths.extend(self.build_layer_cut_paths(ordered_nodes, height, layer_index))

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
    ) -> list[CutterLocationData]:
        ring_coordinates = [(float(x), float(y)) for x, y in polygon.exterior.coords[:-1]]
        if not ring_coordinates:
            return []

        if start_reference is not None:
            start_index = min(
                range(len(ring_coordinates)),
                key=lambda index: (ring_coordinates[index][0] - start_reference.x) ** 2
                + (ring_coordinates[index][1] - start_reference.y) ** 2,
            )
            ring_coordinates = [
                *ring_coordinates[start_index:],
                *ring_coordinates[:start_index],
            ]

        ring_coordinates.append(ring_coordinates[0])

        return [
            CutterLocationData(x=x, y=y, z=z_height)
            for x, y in ring_coordinates
        ]

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
