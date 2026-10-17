import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))

from opencam_rhino.contracts import DocumentState, PartSelection, PlanarRegion, StockBox  # noqa: E402
from opencam_rhino.operations import (  # noqa: E402
    build_operation_payload,
    default_params,
)


def make_state(with_region=True, normal=(0.0, 0.0, 1.0)):
    state = DocumentState(
        part=PartSelection(
            object_id="part",
            name="part",
            mesh={"source": "inline", "vertices": [[0, 0, 0], [1, 0, 0], [0, 1, 0]], "faces": [[0, 1, 2]]},
            stock_box=StockBox(min=[0, 0, 0], max=[20, 20, 10]),
        ),
    )
    if with_region:
        state.region = PlanarRegion(
            source_object_ids=["edge"],
            plane={"origin": [0, 0, 5], "normal": list(normal)},
            outer_loop=[[1, 1, 5], [17, 1, 5], [17, 17, 5], [1, 17, 5], [1, 1, 5]],
            inner_loops=[[[6, 6, 5], [12, 6, 5], [12, 12, 5], [6, 12, 5], [6, 6, 5]]],
        )
    return state


def test_pocketing_payload_maps_region_and_islands():
    payload = build_operation_payload(
        {"id": "op-1", "name": "Rough", "type": "pocketing_2d", "params": {"stepover_percent": 30}},
        make_state(),
    )
    assert payload["type"] == "pocketing_2d"
    assert payload["displayName"] == "Rough"
    assert payload["tool"]["toolNumber"] == 1
    assert payload["cutParameters"]["stepover"] == {"mode": "percentage_of_tool_diameter", "value": 30.0}
    loops = payload["driveGeometry"]
    assert len(loops) == 2  # outer + island
    assert loops[0]["z"] == 5.0
    assert loops[0]["vertices"][0] == {"x": 1.0, "y": 1.0}
    assert payload["clearance"]["clearanceHeightType"] == "stock_max_z_plus_offset"


def test_profiling_payload_maps_side():
    payload = build_operation_payload(
        {"id": "op-2", "name": "Cutout", "type": "profiling_2d", "params": {"side": "outside"}},
        make_state(),
    )
    assert payload["cutParameters"]["side"] == "outside"
    assert len(payload["driveGeometry"]) == 2  # profiling also accepts every loop


def test_parallel_finishing_payload_uses_outer_loop_only():
    payload = build_operation_payload(
        {"id": "op-3", "name": "Finish", "type": "parallel_finishing", "params": {"direction_degrees": 45}},
        make_state(),
    )
    assert payload["cutParameters"]["directionDegrees"] == 45.0
    loops = payload["driveGeometry"]
    assert len(loops) == 1 and "z" not in loops[0]


def test_tilted_region_is_rejected_until_transforms_exist():
    try:
        build_operation_payload(
            {"id": "op-4", "name": "x", "type": "pocketing_2d", "params": {}},
            make_state(normal=(0.0, 1.0, 0.0)),
        )
    except ValueError as error:
        assert "World XY" in str(error)
    else:
        raise AssertionError("Tilted region was accepted")


def test_missing_region_is_rejected():
    try:
        build_operation_payload({"id": "op-5", "name": "x", "type": "pocketing_2d", "params": {}}, make_state(with_region=False))
    except ValueError as error:
        assert "region" in str(error)
    else:
        raise AssertionError("Missing region was accepted")


def test_default_params_reject_unknown_type():
    try:
        default_params("chamfer")
    except ValueError:
        pass
    else:
        raise AssertionError("Unknown type was accepted")
