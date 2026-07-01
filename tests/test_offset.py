import numpy as np

from opencam.engine.closed_polyline.offset import offset, quad_segs_for_tolerance


def test_quad_segs_for_tolerance_scales_with_radius():
    assert quad_segs_for_tolerance(10.0, 0.01) == 18
    assert quad_segs_for_tolerance(100.0, 0.01) == 56


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
