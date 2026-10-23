import json
from pathlib import Path

from opencam_contracts.cam import CAMSetup
from opencam_contracts.cl_data import FeedRatePositionRecord3D
from opencam_contracts.geometry_2_5d import ClosedPolyline25D
from opencam_contracts.operations.base import CAMLevels, FeedsAndSpeeds
from opencam_contracts.operations.pocketing import Pocketing2dOp, PocketingCutSettings, StepoverMode
from opencam_contracts.geometry_2d import Point2D
from opencam_contracts.tools import CylindricalTool
from opencam.services.cam_engine import cam_engine


asset_dir = Path(__file__).resolve().parents[1] / "assets/operations/pocketing"
drive_curve = json.loads((asset_dir / "pocketing_A_drive_curve.json").read_text())

tool = CylindricalTool(
    name="6.35mm flat end mill",
    tool_number=1,
    diameter=6.35,
    cutting_height=20.0,
    shoulder_height=20.0,
)

operation = Pocketing2dOp(
    tool=tool,
    feeds_and_speeds=FeedsAndSpeeds(cut_feedrate=800.0, spindle_rpm=18_000),
    levels=CAMLevels(depth_of_cut=6.0, max_stepdown=6),
    drive_geometry=[
        ClosedPolyline25D(
            z=drive_curve[0][2],
            vertices=[Point2D(x=x, y=y) for x, y, _ in drive_curve],
        )
    ],
    cut_parameters=PocketingCutSettings(
        stepover=StepoverMode(mode="percentage_of_tool_diameter", value=15),
    ),
)

cl_data = cam_engine(CAMSetup(), operation)


if __name__ == "__main__":
    import matplotlib.pyplot as plt
    from matplotlib.ticker import LinearLocator

    figure = plt.figure()
    axes = figure.add_subplot(projection="3d", computed_zorder=False)
    axes.plot(
        [x for x, _, _ in drive_curve],
        [y for _, y, _ in drive_curve],
        [z for _, _, z in drive_curve],
        color="darkgreen",
        zorder=0,
    )
    for start, end in zip(cl_data.records, cl_data.records[1:]):
        axes.plot(
            [start.x, end.x],
            [start.y, end.y],
            [start.z, end.z],
            color="blue" if isinstance(end, FeedRatePositionRecord3D) else "red",
            zorder=1 if isinstance(end, FeedRatePositionRecord3D) else 2,
        )
    axes.set(xlabel="X (mm)", ylabel="Y (mm)")
    axes.set_zlabel("Z (mm)", labelpad=12)
    axes.zaxis.set_major_locator(LinearLocator(3))
    axes.set_box_aspect([high - low for low, high in (axes.get_xlim(), axes.get_ylim(), axes.get_zlim())])
    figure.tight_layout()
    figure.savefig("pocket-toolpath.png", dpi=400)
