import numpy as np

from opencam.engine.closed_polyline.seam_shift import seam_shift


def test_seam_shift_reorders_closed_polyline_from_target_length():
    polyline = np.array(
        [
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 2.0],
            [0.0, 2.0],
            [0.0, 0.0],
        ],
        dtype=np.float64,
    )

    result = seam_shift(polyline, 3.0)

    np.testing.assert_allclose(
        result,
        np.array(
            [
                [2.0, 1.0],
                [2.0, 2.0],
                [0.0, 2.0],
                [0.0, 0.0],
                [2.0, 0.0],
                [2.0, 1.0],
            ],
            dtype=np.float64,
        ),
    )
