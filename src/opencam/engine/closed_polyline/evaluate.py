import numpy as np
from numba import njit

from opencam.engine.closed_polyline.length import length as polyline_length


@njit(cache=True)
def evaluate_length(
    polyline: np.ndarray,
    target_length: float,
) -> np.ndarray:
    """Evaluate a pre-validated closed 2D polyline at an absolute length."""
    total_length = polyline_length(polyline)

    target_length = float(target_length)
    if (
        not np.isfinite(target_length)
        or target_length < 0.0
        or target_length > total_length
    ):
        raise ValueError(
            "Expected a length in the inclusive range [0.0, polyline length]."
        )

    parameter = target_length / total_length
    return evaluate(polyline, parameter)


@njit(cache=True)
def evaluate(
    polyline: np.ndarray,
    parameter: float,
) -> np.ndarray:
    """Evaluate a pre-validated closed 2D polyline."""
    parameter = float(parameter)
    if not np.isfinite(parameter) or parameter < 0.0 or parameter > 1.0:
        raise ValueError("Expected a parameter in the inclusive range [0.0, 1.0].")

    point = np.empty(2, dtype=np.float64)
    total_length = polyline_length(polyline)

    if parameter == 1.0:
        point[0] = polyline[polyline.shape[0] - 1, 0]
        point[1] = polyline[polyline.shape[0] - 1, 1]
        return point

    target_length = parameter * total_length
    cumulative_length = 0.0

    for segment_index in range(polyline.shape[0] - 1):
        start_x = polyline[segment_index, 0]
        start_y = polyline[segment_index, 1]
        dx = polyline[segment_index + 1, 0] - start_x
        dy = polyline[segment_index + 1, 1] - start_y
        segment_length = np.sqrt(dx * dx + dy * dy)
        segment_start_length = cumulative_length
        cumulative_length += segment_length

        if cumulative_length > target_length:
            if segment_length == 0.0:
                point[0] = polyline[segment_index + 1, 0]
                point[1] = polyline[segment_index + 1, 1]
                return point

            segment_parameter = (target_length - segment_start_length) / segment_length
            point[0] = start_x + dx * segment_parameter
            point[1] = start_y + dy * segment_parameter
            return point

    point[0] = polyline[polyline.shape[0] - 1, 0]
    point[1] = polyline[polyline.shape[0] - 1, 1]
    return point
