from __future__ import annotations

import math

import numpy as np

from opencam.services.operations.pocketing.models import (
    Coordinate2D,
    PocketPathTemplate,
    PocketTreeNode,
)


class PocketPathMixin:
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
        current_branch_seam_guide: Coordinate2D | None = None

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
                current_branch_seam_guide = None

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
                seam_guide_reference=current_branch_seam_guide,
            )
            if ring_coordinates.shape[0] == 0:
                continue

            if current_coordinates is None:
                current_branch_seam_guide = self.last_coordinate(ring_coordinates)
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

    def node_to_path_polyline(
        self,
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
                return self.shift_seam_to_branch_side_midpoint(
                    polyline,
                    branch_side_vector,
                    pocket_center,
                )

            reference = seam_guide_reference or start_reference
            if reference is not None:
                return self.shift_seam_to_branch_side_projection(
                    polyline,
                    reference,
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
