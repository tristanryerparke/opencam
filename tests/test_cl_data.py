from opencam_contracts.cl_data import FeedRatePositionRecord3D, OperationRecord3D, RapidPositionRecord3D
from opencam_contracts.tools import CylindricalTool
from opencam.services.tool_mesh import build_tool


def test_operation_records_parse_their_feed_type():
    operation = OperationRecord3D.model_validate(
        {
            "tool": build_tool(
                CylindricalTool(
                    id="tool-1",
                    name="2mm flat end mill",
                    tool_number=1,
                    diameter=2,
                    cutting_height=10,
                    shoulder_height=10,
                )
            ).model_dump(mode="json", by_alias=True),
            "clearancePlaneHeight": 10,
            "records": [
                {"type": "position_3d", "feedType": "rapid", "x": 0, "y": 0, "z": 10},
                {"type": "position_3d", "feedType": "feed_rate", "x": 0, "y": 0, "z": 0, "feedrate": 100.5},
            ],
        }
    )

    assert isinstance(operation.records[0], RapidPositionRecord3D)
    assert isinstance(operation.records[1], FeedRatePositionRecord3D)
    assert operation.records[1].feedrate == 100.5
