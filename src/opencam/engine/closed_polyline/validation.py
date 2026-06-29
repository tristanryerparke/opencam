import numpy as np


def validate_closed_polyline(
    polyline: np.ndarray,
    *,
    allow_empty: bool = False,
) -> np.ndarray:
    """Validate and normalize a closed 2D polyline array."""
    vertices = np.asarray(polyline, dtype=np.float64)
    if vertices.ndim != 2 or vertices.shape[1] != 2:
        raise ValueError("Expected a closed polyline array with shape (N, 2).")

    vertices = np.ascontiguousarray(vertices)
    if vertices.shape[0] == 0:
        if allow_empty:
            return vertices
        raise ValueError("Expected a closed polyline with at least four vertices.")

    if vertices.shape[0] < 4:
        raise ValueError("Expected a closed polyline with at least four vertices.")
    if not np.array_equal(vertices[0], vertices[-1]):
        raise ValueError(
            "Expected a closed polyline where the first and last vertices are equal."
        )

    deltas = vertices[1:] - vertices[:-1]
    total_length = float(
        np.sqrt(deltas[:, 0] * deltas[:, 0] + deltas[:, 1] * deltas[:, 1]).sum()
    )
    if total_length <= 0.0:
        raise ValueError("Expected a closed polyline with positive total length.")

    return vertices
