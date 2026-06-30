from __future__ import annotations

import math
from dataclasses import dataclass, field

import numpy as np
from shapely.geometry import Polygon

from opencam.engine.closed_polyline.evaluate import evaluate_length
from opencam.engine.closed_polyline.offset import offset as offset_closed_polyline
from opencam.engine.closed_polyline.seam_shift import seam_shift
from opencam.engine.closed_polyline.validation import validate_closed_polyline
from opencam.schemas.models import ClosedPolyline, CutterLocationData, Path
from opencam.services.toolpath.base import BaseOperation


Coordinate2D = tuple[float, float]


@dataclass
class PocketTreeNode:
    polyline: np.ndarray
    polygon: Polygon
    parent: PocketTreeNode | None = None
    children: list["PocketTreeNode"] = field(default_factory=list)


@dataclass
class PocketPathTemplate:
    coordinates: np.ndarray


@dataclass
class StraightRunCandidate:
    start_index: int
    end_index: int
    start_length: float
    length: float
    midpoint_length: float
    midpoint: Coordinate2D
    start_point: Coordinate2D
    end_point: Coordinate2D


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

        base_polyline = self.shift_seam_to_longest_straight_edge_near_initial_seam(
            validate_closed_polyline(self.ring.to_numpy())
        )
        layer_heights = self.compute_layer_heights(
            self.z_bounds,
            self.z_step_height,
        )

        ordered_nodes = self.build_ordered_pocket_nodes(base_polyline)
        if not ordered_nodes:
            raise ValueError(
                "Pocketing geometry is too small for the selected tool diameter and stock to leave."
            )

        pocket_center = self.polygon_center(Polygon(base_polyline))
        path_templates = self.build_cut_path_templates(
            ordered_nodes,
            pocket_center=pocket_center,
        )

        cut_paths: list[Path] = []
        for layer_index, height in enumerate(layer_heights, start=1):
            for branch_index, template in enumerate(path_templates, start=1):
                cut_paths.append(
                    Path(
                        name=f"Pocket path L{layer_index} B{branch_index}",
                        kind="cut",
                        locations=self.coordinates_to_locations(
                            template.coordinates,
                            height,
                        ),
                    )
                )

        return self.build_cut_path_sequence(cut_paths)

    def build_ordered_pocket_nodes(self, base_polyline: np.ndarray) -> list[PocketTreeNode]:
        layers = self.build_offset_layers(base_polyline)
        if not layers:
            return []

        roots = self.build_tree(layers)
        ordered_nodes: list[PocketTreeNode] = []
        for root in sorted(roots, key=self.node_sort_key):
            ordered_nodes.extend(self.depth_first_postorder(root))

        return ordered_nodes

    def build_cut_path_templates(
        self,
        ordered_nodes: list[PocketTreeNode],
        *,
        pocket_center: Coordinate2D,
    ) -> list[PocketPathTemplate]:
        templates: list[PocketPathTemplate] = []
        current_coordinates: np.ndarray | None = None
        current_node: PocketTreeNode | None = None
        current_branch_side_vector: Coordinate2D | None = None

        for node in ordered_nodes:
            connects_directly = current_node is not None and self.can_connect_directly(
                current_node,
                node,
            )

            if current_coordinates is not None and not connects_directly:
                templates.append(self.build_path_template(current_coordinates))
                current_coordinates = None
                current_node = None
                current_branch_side_vector = None

            if current_coordinates is None:
                current_branch_side_vector = self.compute_branch_side_vector(
                    node,
                    pocket_center,
                )

            ring_coordinates = self.node_to_path_polyline(
                node,
                start_reference=self.last_coordinate(current_coordinates),
                is_branch_start=current_coordinates is None,
                branch_side_vector=current_branch_side_vector,
                pocket_center=pocket_center,
            )
            if ring_coordinates.shape[0] == 0:
                continue

            if current_coordinates is None:
                current_coordinates = ring_coordinates
                current_node = node
                continue

            current_coordinates = self.append_coordinates(
                current_coordinates,
                ring_coordinates,
            )
            current_node = node

        if current_coordinates is not None:
            templates.append(self.build_path_template(current_coordinates))

        return templates

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

    def build_offset_layers(self, base_polyline: np.ndarray) -> list[list[PocketTreeNode]]:
        first_offset_distance = self.tool.diameter / 2 + self.stock_to_leave
        stepover_distance = self.tool.diameter * (self.stepover / 100)
        offset_distance = first_offset_distance
        layers: list[list[PocketTreeNode]] = []

        while True:
            polylines = offset_closed_polyline(
                base_polyline,
                -offset_distance,
                quad_segs=32,
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

    def node_to_path_polyline(
        self,
        node: PocketTreeNode,
        *,
        start_reference: Coordinate2D | None = None,
        is_branch_start: bool = False,
        branch_side_vector: Coordinate2D | None = None,
        pocket_center: Coordinate2D | None = None,
    ) -> np.ndarray:
        polyline = node.polyline
        if polyline.shape[0] == 0:
            return polyline

        if branch_side_vector is not None and pocket_center is not None:
            if is_branch_start:
                return self.shift_seam_to_branch_side_midpoint(
                    polyline,
                    branch_side_vector,
                    pocket_center,
                )

            if start_reference is not None:
                return self.shift_seam_to_branch_side_projection(
                    polyline,
                    start_reference,
                    branch_side_vector,
                    pocket_center,
                )

        if is_branch_start:
            return self.shift_seam_to_longest_straight_edge_near_initial_seam(polyline)

        if start_reference is not None:
            return self.shift_seam_to_nearest_point_on_longest_straight_edge(
                polyline,
                start_reference,
            )

        return polyline

    def compute_branch_side_vector(
        self,
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

    def shift_seam_to_branch_side_midpoint(
        self,
        polyline: np.ndarray,
        branch_side_vector: Coordinate2D,
        pocket_center: Coordinate2D,
    ) -> np.ndarray:
        candidate = self.select_branch_side_run(
            polyline,
            branch_side_vector,
            pocket_center,
        )
        if candidate is None:
            return self.shift_seam_to_longest_straight_edge_near_initial_seam(polyline)

        return seam_shift(polyline, candidate.midpoint_length)

    def shift_seam_to_branch_side_projection(
        self,
        polyline: np.ndarray,
        start_reference: Coordinate2D,
        branch_side_vector: Coordinate2D,
        pocket_center: Coordinate2D,
    ) -> np.ndarray:
        candidate = self.select_branch_side_run(
            polyline,
            branch_side_vector,
            pocket_center,
            start_reference=start_reference,
        )
        if candidate is None:
            return self.shift_seam_to_nearest_point_on_longest_straight_edge(
                polyline,
                start_reference,
            )

        projected_distance = self.project_point_onto_segment_distance(
            candidate.start_point,
            candidate.end_point,
            start_reference,
        )
        return seam_shift(polyline, candidate.start_length + projected_distance)

    def select_branch_side_run(
        self,
        polyline: np.ndarray,
        branch_side_vector: Coordinate2D,
        pocket_center: Coordinate2D,
        *,
        start_reference: Coordinate2D | None = None,
    ) -> StraightRunCandidate | None:
        candidates = self.straight_run_candidates(polyline)
        if not candidates:
            return None

        max_length = max(candidate.length for candidate in candidates)
        length_threshold = max_length * 0.75
        initial_seam = (float(polyline[0, 0]), float(polyline[0, 1]))

        best_candidate: StraightRunCandidate | None = None
        best_side_score = -math.inf
        best_distance_squared = math.inf
        best_length = -math.inf

        for candidate in candidates:
            if candidate.length + 1e-9 < length_threshold:
                continue

            side_score = self.point_side_score(
                candidate.midpoint,
                pocket_center,
                branch_side_vector,
            )
            if start_reference is None:
                distance_squared = self.distance_squared(candidate.midpoint, initial_seam)
            else:
                projected_distance = self.project_point_onto_segment_distance(
                    candidate.start_point,
                    candidate.end_point,
                    start_reference,
                )
                target_point = evaluate_length(
                    polyline,
                    candidate.start_length + projected_distance,
                )
                distance_squared = self.distance_squared(
                    (float(target_point[0]), float(target_point[1])),
                    start_reference,
                )

            if (
                side_score > best_side_score + 1e-9
                or (
                    math.isclose(side_score, best_side_score, rel_tol=1e-9, abs_tol=1e-9)
                    and distance_squared < best_distance_squared - 1e-9
                )
                or (
                    math.isclose(side_score, best_side_score, rel_tol=1e-9, abs_tol=1e-9)
                    and math.isclose(
                        distance_squared,
                        best_distance_squared,
                        rel_tol=1e-9,
                        abs_tol=1e-9,
                    )
                    and candidate.length > best_length + 1e-9
                )
            ):
                best_candidate = candidate
                best_side_score = side_score
                best_distance_squared = distance_squared
                best_length = candidate.length

        if best_candidate is None or best_side_score <= 1e-9:
            return None

        return best_candidate

    def straight_run_candidates(
        self,
        polyline: np.ndarray,
    ) -> list[StraightRunCandidate]:
        edge_lengths = self.closed_edge_lengths(polyline)
        if edge_lengths.size == 0:
            return []

        candidates: list[StraightRunCandidate] = []
        run_start_length = 0.0
        segment_index = 0

        while segment_index < edge_lengths.size:
            run_end_index = segment_index
            run_length = float(edge_lengths[segment_index])

            while (
                run_end_index + 1 < edge_lengths.size
                and self.segments_form_straight_edge(
                    polyline,
                    run_end_index,
                    run_end_index + 1,
                )
            ):
                run_end_index += 1
                run_length += float(edge_lengths[run_end_index])

            midpoint_length = run_start_length + run_length / 2
            midpoint = evaluate_length(polyline, midpoint_length)
            candidates.append(
                StraightRunCandidate(
                    start_index=segment_index,
                    end_index=run_end_index,
                    start_length=run_start_length,
                    length=run_length,
                    midpoint_length=midpoint_length,
                    midpoint=(float(midpoint[0]), float(midpoint[1])),
                    start_point=(
                        float(polyline[segment_index, 0]),
                        float(polyline[segment_index, 1]),
                    ),
                    end_point=(
                        float(polyline[run_end_index + 1, 0]),
                        float(polyline[run_end_index + 1, 1]),
                    ),
                )
            )

            run_start_length += run_length
            segment_index = run_end_index + 1

        return candidates

    def point_side_score(
        self,
        point: Coordinate2D,
        pocket_center: Coordinate2D,
        branch_side_vector: Coordinate2D,
    ) -> float:
        return (
            (point[0] - pocket_center[0]) * branch_side_vector[0]
            + (point[1] - pocket_center[1]) * branch_side_vector[1]
        )

    def distance_squared(
        self,
        first: Coordinate2D,
        second: Coordinate2D,
    ) -> float:
        dx = first[0] - second[0]
        dy = first[1] - second[1]
        return dx * dx + dy * dy

    def polygon_center(self, polygon: Polygon) -> Coordinate2D:
        min_x, min_y, max_x, max_y = polygon.bounds
        return ((min_x + max_x) / 2, (min_y + max_y) / 2)

    def shift_seam_to_longest_straight_edge_near_initial_seam(
        self,
        polyline: np.ndarray,
    ) -> np.ndarray:
        if polyline.shape[0] < 4:
            return polyline

        target_length = self.longest_straight_edge_midpoint_length_near_initial_seam(
            polyline
        )
        if target_length <= 0.0:
            return polyline

        return seam_shift(polyline, target_length)

    def longest_straight_edge_midpoint_length_near_initial_seam(
        self,
        polyline: np.ndarray,
    ) -> float:
        edge_lengths = self.closed_edge_lengths(polyline)
        if edge_lengths.size == 0:
            return 0.0

        seam_x = float(polyline[0, 0])
        seam_y = float(polyline[0, 1])
        best_length = -1.0
        best_distance_squared = math.inf
        best_midpoint_length = 0.0
        run_start_length = 0.0
        segment_index = 0

        while segment_index < edge_lengths.size:
            run_end_index = segment_index
            run_length = float(edge_lengths[segment_index])

            while (
                run_end_index + 1 < edge_lengths.size
                and self.segments_form_straight_edge(
                    polyline,
                    run_end_index,
                    run_end_index + 1,
                )
            ):
                run_end_index += 1
                run_length += float(edge_lengths[run_end_index])

            midpoint_length = run_start_length + run_length / 2
            midpoint = evaluate_length(polyline, midpoint_length)
            dx = float(midpoint[0] - seam_x)
            dy = float(midpoint[1] - seam_y)
            distance_squared = dx * dx + dy * dy

            if (
                run_length > best_length
                or (
                    math.isclose(run_length, best_length, rel_tol=1e-9, abs_tol=1e-9)
                    and distance_squared < best_distance_squared
                )
            ):
                best_length = run_length
                best_distance_squared = distance_squared
                best_midpoint_length = midpoint_length

            run_start_length += run_length
            segment_index = run_end_index + 1

        return best_midpoint_length

    def segments_form_straight_edge(
        self,
        polyline: np.ndarray,
        first_segment_index: int,
        second_segment_index: int,
    ) -> bool:
        first_dx = float(
            polyline[first_segment_index + 1, 0] - polyline[first_segment_index, 0]
        )
        first_dy = float(
            polyline[first_segment_index + 1, 1] - polyline[first_segment_index, 1]
        )
        second_dx = float(
            polyline[second_segment_index + 1, 0] - polyline[second_segment_index, 0]
        )
        second_dy = float(
            polyline[second_segment_index + 1, 1] - polyline[second_segment_index, 1]
        )

        first_length_squared = first_dx * first_dx + first_dy * first_dy
        second_length_squared = second_dx * second_dx + second_dy * second_dy
        if first_length_squared <= 0.0 or second_length_squared <= 0.0:
            return False

        cross = first_dx * second_dy - first_dy * second_dx
        if abs(cross) > 1e-6 * math.sqrt(first_length_squared * second_length_squared):
            return False

        dot = first_dx * second_dx + first_dy * second_dy
        return dot > 0.0

    def shift_seam_to_nearest_point_on_longest_straight_edge(
        self,
        polyline: np.ndarray,
        start_reference: Coordinate2D,
    ) -> np.ndarray:
        target_length = self.nearest_point_on_longest_straight_edge_length(
            polyline,
            start_reference,
        )
        if target_length <= 0.0:
            return polyline

        return seam_shift(polyline, target_length)

    def nearest_point_on_longest_straight_edge_length(
        self,
        polyline: np.ndarray,
        start_reference: Coordinate2D,
    ) -> float:
        edge_lengths = self.closed_edge_lengths(polyline)
        if edge_lengths.size == 0:
            return 0.0

        reference_x, reference_y = start_reference
        best_length = -1.0
        best_distance_squared = math.inf
        best_target_length = 0.0
        run_start_length = 0.0
        segment_index = 0

        while segment_index < edge_lengths.size:
            run_end_index = segment_index
            run_length = float(edge_lengths[segment_index])

            while (
                run_end_index + 1 < edge_lengths.size
                and self.segments_form_straight_edge(
                    polyline,
                    run_end_index,
                    run_end_index + 1,
                )
            ):
                run_end_index += 1
                run_length += float(edge_lengths[run_end_index])

            run_start_point = polyline[segment_index]
            run_end_point = polyline[run_end_index + 1]
            projected_distance = self.project_point_onto_segment_distance(
                (float(run_start_point[0]), float(run_start_point[1])),
                (float(run_end_point[0]), float(run_end_point[1])),
                start_reference,
            )
            target_length = run_start_length + projected_distance
            target_point = evaluate_length(polyline, target_length)
            dx = float(target_point[0] - reference_x)
            dy = float(target_point[1] - reference_y)
            distance_squared = dx * dx + dy * dy

            if (
                run_length > best_length
                or (
                    math.isclose(run_length, best_length, rel_tol=1e-9, abs_tol=1e-9)
                    and distance_squared < best_distance_squared
                )
            ):
                best_length = run_length
                best_distance_squared = distance_squared
                best_target_length = target_length

            run_start_length += run_length
            segment_index = run_end_index + 1

        return best_target_length

    def project_point_onto_segment_distance(
        self,
        segment_start: Coordinate2D,
        segment_end: Coordinate2D,
        point: Coordinate2D,
    ) -> float:
        segment_dx = segment_end[0] - segment_start[0]
        segment_dy = segment_end[1] - segment_start[1]
        segment_length_squared = segment_dx * segment_dx + segment_dy * segment_dy
        if segment_length_squared <= 0.0:
            return 0.0

        point_dx = point[0] - segment_start[0]
        point_dy = point[1] - segment_start[1]
        projection = (
            point_dx * segment_dx + point_dy * segment_dy
        ) / segment_length_squared
        clamped_projection = max(0.0, min(1.0, projection))
        return math.sqrt(segment_length_squared) * clamped_projection

    def closed_edge_lengths(self, polyline: np.ndarray) -> np.ndarray:
        if polyline.shape[0] < 2:
            return np.empty(0, dtype=np.float64)

        deltas = polyline[1:] - polyline[:-1]
        return np.sqrt(deltas[:, 0] * deltas[:, 0] + deltas[:, 1] * deltas[:, 1])

    def vertex_length_at_index(self, polyline: np.ndarray, vertex_index: int) -> float:
        if vertex_index <= 0:
            return 0.0

        total_length = 0.0
        for index in range(vertex_index):
            total_length += math.hypot(
                polyline[index + 1, 0] - polyline[index, 0],
                polyline[index + 1, 1] - polyline[index, 1],
            )

        return total_length

    def append_coordinates(
        self,
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

    def build_path_template(self, coordinates: np.ndarray) -> PocketPathTemplate:
        return PocketPathTemplate(coordinates=np.ascontiguousarray(coordinates))

    def last_coordinate(self, coordinates: np.ndarray | None) -> Coordinate2D | None:
        if coordinates is None or coordinates.shape[0] == 0:
            return None
        return (float(coordinates[-1, 0]), float(coordinates[-1, 1]))

    def coordinates_to_locations(
        self,
        coordinates: np.ndarray,
        z_height: float,
    ) -> list[CutterLocationData]:
        return [
            CutterLocationData(x=float(x), y=float(y), z=z_height)
            for x, y in coordinates
        ]

    def polygon_sort_key(self, polygon: Polygon) -> tuple[float, float, float]:
        point = polygon.representative_point()
        return (round(point.x, 6), round(point.y, 6), -polygon.area)

    def node_sort_key(self, node: PocketTreeNode) -> tuple[float, float, float]:
        return self.polygon_sort_key(node.polygon)
