import numpy as np


def flip(polyline: np.ndarray) -> np.ndarray:
    """Reverse the direction of a pre-validated closed 2D polyline."""
    return np.ascontiguousarray(polyline[::-1])
