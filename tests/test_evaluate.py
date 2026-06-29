import numpy as np

from opencam.engine.closed_polyline.evaluate import evaluate, evaluate_length


def test_evaluate_on_closed_polyline():
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

    result = evaluate(polyline, 0.875)

    np.testing.assert_allclose(result, np.array([0.0, 1.0]))


def test_evaluate_skips_zero_length_segments():
    polyline = np.array(
        [
            [0.0, 0.0],
            [0.0, 0.0],
            [2.0, 0.0],
            [2.0, 2.0],
            [0.0, 2.0],
            [0.0, 0.0],
        ],
        dtype=np.float64,
    )

    result = evaluate(polyline, 0.125)

    np.testing.assert_allclose(result, np.array([1.0, 0.0]))


def test_evaluate_returns_closed_endpoints():
    polyline = np.array(
        [
            [1.0, 2.0],
            [3.0, 2.0],
            [3.0, 4.0],
            [1.0, 4.0],
            [1.0, 2.0],
        ],
        dtype=np.float64,
    )

    np.testing.assert_allclose(evaluate(polyline, 0.0), np.array([1.0, 2.0]))
    np.testing.assert_allclose(evaluate(polyline, 1.0), np.array([1.0, 2.0]))


def test_evaluate_length_on_closed_polyline():
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

    result = evaluate_length(polyline, 7.0)

    np.testing.assert_allclose(result, np.array([0.0, 1.0]))
