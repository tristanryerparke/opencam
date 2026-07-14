import numpy as np

from opencam.simulation.swept_volume import coalesce_straight_tool_positions


def test_coalesce_straight_tool_positions_merges_straight_runs():
    positions = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([2.0, 0.0, 0.0]),
        np.array([3.0, 0.0, 0.0]),
    ]

    coalesced = coalesce_straight_tool_positions(positions, 0.1)

    assert len(coalesced) == 2
    np.testing.assert_allclose(coalesced[0], positions[0])
    np.testing.assert_allclose(coalesced[1], positions[-1])


def test_coalesce_straight_tool_positions_keeps_turns_and_reversals():
    turned = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([1.0, 1.0, 0.0]),
    ]
    reversed_path = [
        np.array([0.0, 0.0, 0.0]),
        np.array([1.0, 0.0, 0.0]),
        np.array([0.5, 0.0, 0.0]),
    ]

    assert len(coalesce_straight_tool_positions(turned, 0.1)) == 3
    assert len(coalesce_straight_tool_positions(reversed_path, 0.1)) == 3
