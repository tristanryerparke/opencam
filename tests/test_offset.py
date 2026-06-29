import numpy as np

from opencam.engine.closed_polyline.offset import offset


def test_offset_returns_empty_for_empty_polyline():
    assert offset(np.empty((0, 2), dtype=np.float64), 1.0) == []


def test_offset_inward_rectangle():
    rectangle = np.array(
        [
            [0.0, 0.0],
            [10.0, 0.0],
            [10.0, 6.0],
            [0.0, 6.0],
            [0.0, 0.0],
        ]
    )

    result = offset(rectangle, -1.0)

    assert len(result) == 1
    np.testing.assert_allclose(
        result[0],
        np.array(
            [
                [1.0, 1.0],
                [1.0, 5.0],
                [9.0, 5.0],
                [9.0, 1.0],
                [1.0, 1.0],
            ]
        ),
    )
