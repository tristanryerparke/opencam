from dataclasses import asdict
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parents[1] / "python"))

from opencam_rhino.contracts import (  # noqa: E402
    DocumentState,
    PanelRequest,
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
        region=PlanarRegion(
            source_object_ids=["edge-id"],
            plane={"origin": [0, 0, 0]},
            outer_loop=[[0, 0, 0], [1, 0, 0], [0, 0, 0]],
        ),
    )
    assert asdict(state)["part"]["stock_box"]["max"] == [1, 2, 3]


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
