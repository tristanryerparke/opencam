import math

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.cl_data import (
    FeedRatePositionRecord3D,
    PositionRecord,
    PositionRecord3D,
    RapidPositionRecord3D,
)
from opencam.schemas.models import Tool


class BaseOperation(CamelBaseModel):
    tool: Tool
    tool_id: str
    feedrate: float
    rpm: int
    clearance_plane_height: float = 25.4

    def compute_layer_heights(
        self,
        z_bounds: tuple[float, float],
        z_step_height: float,
    ) -> list[float]:
        if z_step_height <= 0:
            raise ValueError("Z step height must be greater than 0.")

        top_z = max(z_bounds)
        bottom_z = min(z_bounds)
        depth_of_cut = top_z - bottom_z

        if depth_of_cut <= 0 or depth_of_cut <= z_step_height:
            return [bottom_z]

        layer_heights: list[float] = []
        current_z = top_z

        while True:
            next_z = max(current_z - z_step_height, bottom_z)
            layer_heights.append(next_z)
            if next_z <= bottom_z:
                break
            current_z = next_z

        return layer_heights

    def rapid_position(
        self,
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

    @staticmethod
    def positions_match(left: PositionRecord3D, right: PositionRecord3D) -> bool:
        return left.x == right.x and left.y == right.y and left.z == right.z

    def build_rapid_records(
        self,
        start: PositionRecord3D | None,
        end: PositionRecord3D | None,
    ) -> list[RapidPositionRecord3D]:
        if start is None and end is None:
            return []

        if start is None:
            assert end is not None
            return [
                self.rapid_position(end, z=self.clearance_plane_height, comment="start at clearance plane"),
                self.rapid_position(end, comment="move to operation start"),
            ]

        if end is None:
            return [self.rapid_position(start, z=self.clearance_plane_height, comment="return to clearance plane")]

        records = [
            self.rapid_position(start, z=self.clearance_plane_height, comment="move up to clearance plane"),
            self.rapid_position(end, z=self.clearance_plane_height, comment="move in clearance plane"),
            self.rapid_position(end, comment="move to next cut"),
        ]
        return [record for index, record in enumerate(records) if index == 0 or not self.positions_match(record, records[index - 1])]

    def build_cut_record_sequence(
        self,
        cut_records: list[list[FeedRatePositionRecord3D]],
    ) -> list[PositionRecord]:
        records: list[PositionRecord] = []
        current: PositionRecord3D | None = None

        for cut in cut_records:
            if not cut:
                continue
            records.extend(self.build_rapid_records(current, cut[0]))
            records.extend(cut)
            current = cut[-1]

        records.extend(self.build_rapid_records(current, None))
        return records

    def build_records_with_clearance(
        self,
        cut_records: list[FeedRatePositionRecord3D],
    ) -> list[PositionRecord]:
        return self.build_cut_record_sequence([cut_records] if cut_records else [])
