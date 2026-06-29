import numpy as np

from opencam.engine.closed_polyline.dedup import dedup


def test_dedup_returns_empty_for_empty_polyline():
    result = dedup(np.empty((0, 2), dtype=np.float64))

    assert result.shape == (0, 2)
    assert result.dtype == np.float64


def test_dedup_cleans_closed_polyline():
    polyline = np.array(
        [
            [0.0, 0.0],
            [0.0005, 0.0002],
            [2.0, 0.0],
            [2.0, 0.0004],
            [2.0, 2.0],
            [0.0, 2.0],
            [0.0, 0.0005],
            [0.0, 0.0],
        ]
    )

    result = dedup(polyline)

    np.testing.assert_allclose(
        result,
        np.array(
            [
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 2.0],
                [0.0, 2.0],
                [0.0, 0.0],
            ]
        ),
    )
