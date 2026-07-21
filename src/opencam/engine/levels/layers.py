from __future__ import annotations

import numpy as np

from opencam.schemas.cl_data import (
    FeedRatePositionRecord3D,
    PositionRecord,
    PositionRecord3D,
    RapidPositionRecord3D,
)


def duplicate_layers_at_heights(
    layers: list[np.ndarray],
    heights: list[float],
    *,
    feedrate: float,
) -> list[list[FeedRatePositionRecord3D]]:
    return [
        [
            FeedRatePositionRecord3D(
                x=float(x),
                y=float(y),
                z=height,
                feedrate=feedrate,
            )
            for x, y in layer
        ]
        for height in heights
        for layer in layers
    ]


def rapid_position(
    location: PositionRecord3D,
    *,
    z: float | None = None,
    comment: str | None = None,
) -> RapidPositionRecord3D:
    return RapidPositionRecord3D(
        x=location.x,
        y=location.y,
        z=location.z if z is None else z,
        comment=comment,
    )


def positions_match(left: PositionRecord3D, right: PositionRecord3D) -> bool:
    return left.x == right.x and left.y == right.y and left.z == right.z


def build_rapid_records(
    start: PositionRecord3D | None,
    end: PositionRecord3D | None,
    *,
    clearance_plane_height: float,
) -> list[RapidPositionRecord3D]:
    if start is None and end is None:
        return []

    if start is None:
        assert end is not None
        return [
            rapid_position(end, z=clearance_plane_height, comment="start at clearance plane"),
            rapid_position(end, comment="move to operation start"),
        ]

    if end is None:
        return [rapid_position(start, z=clearance_plane_height, comment="return to clearance plane")]

    records = [
        rapid_position(start, z=clearance_plane_height, comment="move up to clearance plane"),
        rapid_position(end, z=clearance_plane_height, comment="move in clearance plane"),
        rapid_position(end, comment="move to next cut"),
    ]
    return [record for index, record in enumerate(records) if index == 0 or not positions_match(record, records[index - 1])]


def build_cut_record_sequence(
    cut_layers: list[list[FeedRatePositionRecord3D]],
    *,
    clearance_plane_height: float,
) -> list[PositionRecord]:
    records: list[PositionRecord] = []
    current: PositionRecord3D | None = None

    for cut_layer in cut_layers:
        if not cut_layer:
            continue
        records.extend(
            build_rapid_records(
                current,
                cut_layer[0],
                clearance_plane_height=clearance_plane_height,
            )
        )
        records.extend(cut_layer)
        current = cut_layer[-1]

    records.extend(
        build_rapid_records(
            current,
            None,
            clearance_plane_height=clearance_plane_height,
        )
    )
    return records


def xy_travel_record(
    start: PositionRecord3D,
    end: PositionRecord3D,
    *,
    comment: str = "travel to next pocket",
) -> RapidPositionRecord3D | None:
    if positions_match(start, end):
        return None
    return RapidPositionRecord3D(
        x=end.x,
        y=end.y,
        z=start.z,
        comment=comment,
    )


def stitch_geometry_records(
    record_groups: list[list[PositionRecord]],
    *,
    travel_comment: str = "travel to next pocket",
) -> list[PositionRecord]:
    records: list[PositionRecord] = []

    for geometry_records in record_groups:
        if records and geometry_records:
            travel = xy_travel_record(
                records[-1],
                geometry_records[0],
                comment=travel_comment,
            )
            if travel is not None:
                records.append(travel)
            if positions_match(records[-1], geometry_records[0]):
                geometry_records = geometry_records[1:]
        records.extend(geometry_records)

    return records
