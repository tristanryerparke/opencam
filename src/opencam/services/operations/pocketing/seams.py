from __future__ import annotations

import math

import numpy as np

import opencam.engine.closed_polyline as cp
from opencam.services.operations.pocketing.models import (
    Coordinate2D,
    StraightRunCandidate,
)


class PocketSeamMixin:
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

        return cp.seam_shift(polyline, candidate.midpoint_length)

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
        return cp.seam_shift(polyline, candidate.start_length + projected_distance)

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
                target_point = cp.evaluate_length(
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
            midpoint = cp.evaluate_length(polyline, midpoint_length)
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

        return cp.seam_shift(polyline, target_length)

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
            midpoint = cp.evaluate_length(polyline, midpoint_length)
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

        return cp.seam_shift(polyline, target_length)

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
            target_point = cp.evaluate_length(polyline, target_length)
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
