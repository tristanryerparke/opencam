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


def dedup(
    polyline: np.ndarray,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Remove adjacent duplicate vertices from a pre-validated closed 2D polyline."""
    result = _dedup_impl(polyline, tolerance)
    return validate_closed_polyline(result, allow_empty=True)
