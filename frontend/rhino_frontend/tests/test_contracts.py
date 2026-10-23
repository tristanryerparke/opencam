from dataclasses import asdict
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))

from opencam_rhino.display import ToolpathPreview  # noqa: E402
from opencam_rhino.contracts import (  # noqa: E402
    DocumentState,
    OperationSpec,
    PanelRequest,
    SetupSpec,
    PartSelection,
    PlanarRegion,
    StockBox,
    panel_event,
)


def test_document_state_is_json_safe_with_part_and_region():
    state = DocumentState(
        part=PartSelection(
            object_id="part-id",
            name="part",
            mesh={"source": "inline", "vertices": [[0, 0, 0]], "faces": [[0, 0, 0]]},
            stock_box=StockBox(min=[0, 0, 0], max=[1, 2, 3]),
        ),
        setups=[SetupSpec(
            id="setup-1",
            name="Setup 1",
            operations=[OperationSpec(
                id="op-1",
                name="Pocket",
                type="pocketing_2d",
                regions=[PlanarRegion(
                    source_object_ids=["edge-id"],
                    plane={"origin": [0, 0, 0]},
                    outer_loop=[[0, 0, 0], [1, 0, 0], [0, 0, 0]],
                )],
            )],
        )],
    )
    assert asdict(state)["part"]["stock_box"]["max"] == [1, 2, 3]
    assert asdict(state)["setups"][0]["operations"][0]["regions"][0]["source_object_ids"] == ["edge-id"]


def test_panel_request_rejects_unknown_protocol():
    try:
        PanelRequest.from_dict({"protocol_version": 999, "action": "get_state"})
    except ValueError as error:
        assert "protocol" in str(error).lower()
    else:
        raise AssertionError("Unsupported protocol was accepted")


def test_panel_event_preserves_request_correlation_id():
    request = PanelRequest.from_dict({"action": "get_state", "request_id": "abc"})
    assert panel_event(request, DocumentState(), ok=True)["request_id"] == "abc"


def test_toolpath_preview_groups_motion_roles_and_keeps_transition_point():
    # A move takes the role of its endpoint record (the project's display
    # convention), so a lone leading rapid point forms a degenerate segment
    # that is not drawable; it survives as the start marker instead.
    preview = ToolpathPreview.from_operation(
        {"records": [
            {"x": 0, "y": 0, "z": 1, "feedType": "rapid", "motionRole": "travel"},
            {"x": 0, "y": 0, "z": 0, "feedType": "feed_rate", "motionRole": "cutting"},
            {"x": 1, "y": 0, "z": 0, "feedType": "feed_rate", "motionRole": "cutting"},
            {"x": 2, "y": 0, "z": 0, "feedType": "feed_rate", "motionRole": "linking"},
        ]}
    )
    assert [segment.role for segment in preview.segments] == ["cutting", "linking"]
    assert preview.segments[0].points[0] == (0.0, 0.0, 1.0)
    assert preview.segments[0].points[-1] == preview.segments[1].points[0]
    assert preview.start == (0.0, 0.0, 1.0)
    assert preview.end == (2.0, 0.0, 0.0)
