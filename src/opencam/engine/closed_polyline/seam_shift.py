import numpy as np
from numba import njit

from opencam.engine.closed_polyline.cleanup import _dedup_impl
from opencam.engine.closed_polyline.evaluate import evaluate_length
from opencam.engine.closed_polyline.validation import validate_closed_polyline


@njit(cache=True)
def _seam_shift_impl(
    polyline: np.ndarray,
    target_length: float,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Shift a pre-validated closed 2D polyline seam to an absolute length."""
    if polyline.shape[0] == 0:
        return np.ascontiguousarray(polyline.copy())

    seam = evaluate_length(polyline, target_length)
    target_length = float(target_length)

    segment_count = polyline.shape[0] - 1
    cumulative_length = 0.0
    segment_index = 0
    found_segment = False

    for index in range(segment_count):
        dx = polyline[index + 1, 0] - polyline[index, 0]
        dy = polyline[index + 1, 1] - polyline[index, 1]
        cumulative_length += np.sqrt(dx * dx + dy * dy)

        if not found_segment and cumulative_length > target_length:
            segment_index = index
            found_segment = True

    if not found_segment:
        segment_index = 0

    shifted = np.empty((polyline.shape[0] + 1, 2), dtype=np.float64)
    write_index = 0

    shifted[write_index, 0] = seam[0]
    shifted[write_index, 1] = seam[1]
    write_index += 1

    for index in range(segment_index + 1, polyline.shape[0]):
        shifted[write_index, 0] = polyline[index, 0]
        shifted[write_index, 1] = polyline[index, 1]
        write_index += 1

    for index in range(1, segment_index + 1):
        shifted[write_index, 0] = polyline[index, 0]
        shifted[write_index, 1] = polyline[index, 1]
        write_index += 1

    shifted[write_index, 0] = seam[0]
    shifted[write_index, 1] = seam[1]

    return _dedup_impl(shifted, tolerance)


def seam_shift(
    polyline: np.ndarray,
    target_length: float,
    tolerance: float = 0.001,
) -> np.ndarray:
    """Shift a pre-validated closed 2D polyline seam to an absolute length."""
    result = _seam_shift_impl(polyline, target_length, tolerance)
    return validate_closed_polyline(result, allow_empty=True)
