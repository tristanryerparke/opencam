import numpy as np
import pytest

from opencam.engine.closed_polyline.validation import validate_closed_polyline


def test_validate_closed_polyline_normalizes_array():
    polyline = np.asfortranarray(
        np.array(
            [
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 2.0],
                [0.0, 0.0],
            ],
            dtype=np.float64,
        )
    )

    result = validate_closed_polyline(polyline)

    assert result.dtype == np.float64
    assert result.flags.c_contiguous
    np.testing.assert_allclose(result, polyline)


def test_validate_closed_polyline_allows_empty_when_requested():
    result = validate_closed_polyline(
        np.empty((0, 2), dtype=np.float64),
        allow_empty=True,
    )

    assert result.shape == (0, 2)
    assert result.dtype == np.float64


def test_validate_closed_polyline_rejects_open_polyline():
    polyline = np.array(
        [
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 2.0],
            [0.0, 2.0],
        ],
        dtype=np.float64,
    )

    with pytest.raises(ValueError, match="first and last vertices are equal"):
        validate_closed_polyline(polyline)


def test_validate_closed_polyline_rejects_zero_length_polyline():
    polyline = np.array(
        [
            [0.0, 0.0],
            [0.0, 0.0],
            [0.0, 0.0],
            [0.0, 0.0],
        ],
        dtype=np.float64,
    )

    with pytest.raises(ValueError, match="positive total length"):
        validate_closed_polyline(polyline)
