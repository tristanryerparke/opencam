import math

from opencam.schemas.base import CamelBaseModel
from opencam.schemas.models import CutterLocationData, Path, Tool


class BaseOperation(CamelBaseModel):
    tool: Tool
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

        if depth_of_cut <= 0:
            return [bottom_z]

        if depth_of_cut <= z_step_height:
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

    def clearance_location(
        self,
        location: CutterLocationData,
        *,
        comment: str | None = None,
    ) -> CutterLocationData:
        return CutterLocationData(
            x=location.x,
            y=location.y,
            z=self.clearance_plane_height,
            comment=comment,
        )

    def dedupe_locations(
        self,
        locations: list[CutterLocationData],
    ) -> list[CutterLocationData]:
        deduped: list[CutterLocationData] = []

        for location in locations:
            if deduped and (
                deduped[-1].x == location.x
                and deduped[-1].y == location.y
                and deduped[-1].z == location.z
            ):
                continue
            deduped.append(location)

        return deduped

    def build_clearance_path(
        self,
        start: CutterLocationData | None,
        end: CutterLocationData | None,
        *,
        name: str,
    ) -> Path | None:
        if start is None and end is None:
            return None

        locations: list[CutterLocationData] = []

        if start is None and end is not None:
            locations = [
                self.clearance_location(end, comment="start at clearance plane"),
                CutterLocationData(
                    x=end.x,
                    y=end.y,
                    z=end.z,
                    comment="move to operation start",
                ),
            ]
        elif start is not None and end is None:
            locations = [
                CutterLocationData(
                    x=start.x,
                    y=start.y,
                    z=start.z,
                    comment="leave operation end",
                ),
                self.clearance_location(start, comment="return to clearance plane"),
            ]
        elif start is not None and end is not None:
            locations = [
                CutterLocationData(
                    x=start.x,
                    y=start.y,
                    z=start.z,
                    comment="leave current cut",
                ),
                self.clearance_location(start, comment="move up to clearance plane"),
                self.clearance_location(end, comment="move in clearance plane"),
                CutterLocationData(
                    x=end.x,
                    y=end.y,
                    z=end.z,
                    comment="move to next cut",
                ),
            ]

        locations = self.dedupe_locations(locations)
        if len(locations) < 2:
            return None

        return Path(
            name=name,
            kind="clearance",
            locations=locations,
        )

    def build_cut_path_sequence(self, cut_paths: list[Path]) -> list[Path]:
        ordered_cut_paths = [path for path in cut_paths if path.locations]
        if not ordered_cut_paths:
            return []

        paths: list[Path] = []
        current_location: CutterLocationData | None = None

        for cut_path in ordered_cut_paths:
            clearance_path = self.build_clearance_path(
                current_location,
                cut_path.locations[0],
                name=(
                    "Approach from clearance plane"
                    if current_location is None
                    else "Clearance transition"
                ),
            )
            if clearance_path is not None:
                paths.append(clearance_path)

            paths.append(cut_path)
            current_location = cut_path.locations[-1]

        if current_location is not None:
            return_path = self.build_clearance_path(
                current_location,
                None,
                name="Return to clearance plane",
            )
            if return_path is not None:
                paths.append(return_path)

        return paths

    def build_paths_with_clearance(
        self,
        cut_locations: list[CutterLocationData],
        *,
        cut_path_name: str | None = None,
    ) -> list[Path]:
        if not cut_locations:
            return []

        return self.build_cut_path_sequence(
            [
                Path(
                    name=cut_path_name,
                    kind="cut",
                    locations=cut_locations,
                )
            ]
        )

