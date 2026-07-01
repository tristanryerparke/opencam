import numpy as np
from numba import njit

from opencam.engine.closed_polyline.validation import validate_closed_polyline


@njit(cache=True)
def _dedup_impl(
    polyline: np.ndarray,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Remove adjacent duplicate vertices from a pre-validated closed 2D polyline."""
    if tolerance < 0:
        raise ValueError("Expected a non-negative tolerance.")

    if polyline.shape[0] == 0:
        return polyline

    tolerance_squared = tolerance * tolerance
    deduped = np.empty_like(polyline)
    deduped_count = 1
    deduped[0, 0] = polyline[0, 0]
    deduped[0, 1] = polyline[0, 1]

    for index in range(1, polyline.shape[0] - 1):
        dx = polyline[index, 0] - deduped[deduped_count - 1, 0]
        dy = polyline[index, 1] - deduped[deduped_count - 1, 1]
        if dx * dx + dy * dy <= tolerance_squared:
            continue

        deduped[deduped_count, 0] = polyline[index, 0]
        deduped[deduped_count, 1] = polyline[index, 1]
        deduped_count += 1

    while deduped_count > 1:
        dx = deduped[deduped_count - 1, 0] - deduped[0, 0]
        dy = deduped[deduped_count - 1, 1] - deduped[0, 1]
        if dx * dx + dy * dy > tolerance_squared:
            break
        deduped_count -= 1

    if deduped_count < 3:
        raise ValueError("Expected at least three distinct vertices after cleanup.")

    result = np.empty((deduped_count + 1, 2), dtype=np.float64)
    for index in range(deduped_count):
        result[index, 0] = deduped[index, 0]
        result[index, 1] = deduped[index, 1]

    result[deduped_count, 0] = deduped[0, 0]
    result[deduped_count, 1] = deduped[0, 1]
    return result



@njit(cache=True)
def _simplify_impl(
    polyline: np.ndarray,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Simplify a pre-validated closed 2D polyline by removing flat vertices."""
    if tolerance < 0:
        raise ValueError("Expected a non-negative tolerance.")

    if polyline.shape[0] == 0:
        return polyline

    simplified = np.empty_like(polyline)
    simplified_count = polyline.shape[0] - 1
    for index in range(simplified_count):
        simplified[index, 0] = polyline[index, 0]
        simplified[index, 1] = polyline[index, 1]

    tolerance_squared = tolerance * tolerance
    changed = True
    while changed:
        changed = False
        index = 0
        while index < simplified_count:
            previous_index = index - 1
            if previous_index < 0:
                previous_index = simplified_count - 1

            next_index = index + 1
            if next_index == simplified_count:
                next_index = 0

            start_x = simplified[previous_index, 0]
            start_y = simplified[previous_index, 1]
            end_x = simplified[next_index, 0]
            end_y = simplified[next_index, 1]
            point_x = simplified[index, 0]
            point_y = simplified[index, 1]

            line_dx = end_x - start_x
            line_dy = end_y - start_y
            line_length_squared = line_dx * line_dx + line_dy * line_dy
            if line_length_squared <= 0.0:
                point_dx = point_x - start_x
                point_dy = point_y - start_y
                distance_squared = point_dx * point_dx + point_dy * point_dy
            else:
                position = (
                    (point_x - start_x) * line_dx + (point_y - start_y) * line_dy
                ) / line_length_squared
                if position <= 0.0:
                    closest_x = start_x
                    closest_y = start_y
                elif position >= 1.0:
                    closest_x = end_x
                    closest_y = end_y
                else:
                    closest_x = start_x + position * line_dx
                    closest_y = start_y + position * line_dy

                distance_x = point_x - closest_x
                distance_y = point_y - closest_y
                distance_squared = distance_x * distance_x + distance_y * distance_y

            if distance_squared <= tolerance_squared:
                if simplified_count <= 3:
                    raise ValueError("Expected at least three distinct vertices after cleanup.")

                for shift_index in range(index, simplified_count - 1):
                    simplified[shift_index, 0] = simplified[shift_index + 1, 0]
                    simplified[shift_index, 1] = simplified[shift_index + 1, 1]

                simplified_count -= 1
                changed = True
                continue

            index += 1

    result = np.empty((simplified_count + 1, 2), dtype=np.float64)
    for index in range(simplified_count):
        result[index, 0] = simplified[index, 0]
        result[index, 1] = simplified[index, 1]

    result[simplified_count, 0] = simplified[0, 0]
    result[simplified_count, 1] = simplified[0, 1]
    return result


def dedup(
    polyline: np.ndarray,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Remove adjacent duplicate vertices from a pre-validated closed 2D polyline."""
    result = _dedup_impl(polyline, tolerance)
    return validate_closed_polyline(result, allow_empty=True)


def simplify(
    polyline: np.ndarray,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Simplify a pre-validated closed 2D polyline by removing flat vertices."""
    result = _simplify_impl(polyline, tolerance)
    return validate_closed_polyline(result, allow_empty=True)
