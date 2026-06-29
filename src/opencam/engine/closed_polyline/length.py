import numpy as np
from numba import njit


@njit(cache=True)
def length(polyline: np.ndarray) -> float:
    """Return the total perimeter length of a pre-validated closed 2D polyline."""
    total_length = 0.0

    for index in range(polyline.shape[0] - 1):
        dx = polyline[index + 1, 0] - polyline[index, 0]
        dy = polyline[index + 1, 1] - polyline[index, 1]
        total_length += np.sqrt(dx * dx + dy * dy)

    return float(total_length)
