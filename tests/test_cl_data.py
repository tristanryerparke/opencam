from opencam.schemas.cl_data import FeedRatePositionRecord3D, OperationRecord3D, RapidPositionRecord3D


def test_operation_records_parse_their_feed_type():
    operation = OperationRecord3D.model_validate(
        {
            "toolId": "tool-1",
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
