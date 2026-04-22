import plotly.graph_objects as go
import plotly.io as pio

from models import ClosedPolyline, Point2D, Tool
from profiling import ClosedProfilingEngine


ring = ClosedPolyline(
    vertices=[
        Point2D(x=0, y=0),
        Point2D(x=40, y=0),
        Point2D(x=40, y=20),
        Point2D(x=25, y=20),
        Point2D(x=25, y=12),
        Point2D(x=15, y=12),
        Point2D(x=15, y=20),
        Point2D(x=0, y=20),
        Point2D(x=0, y=0),
    ],
)

tool = Tool(
    diameter=6.35,
    cutting_height=20.0,
    max_depth_of_cut=2.0,
)

engine = ClosedProfilingEngine(
    ring=ring,
    side="outside",
    tool=tool,
    feedrate=500,
    rpm=12000,
    z_bounds=(-6.0, 0.0),
    z_step_height=1.25,
    stock_to_leave=0.25,
)

pio.renderers.default = "browser"

path = engine.process()

fig = go.Figure()
original_points = list(ring.to_shapely().coords)
fig.add_trace(
    go.Scatter3d(
        x=[point[0] for point in original_points],
        y=[point[1] for point in original_points],
        z=[0 for _ in original_points],
        mode="lines",
        name="original polyline",
        line=dict(color="black", dash="dash"),
    )
)

points = path.as_numpy()
fig.add_trace(
    go.Scatter3d(
        x=points[:, 0],
        y=points[:, 1],
        z=points[:, 2],
        mode="lines",
        name="cam path",
        line=dict(color="royalblue"),
    )
)
fig.add_trace(
    go.Scatter3d(
        x=[points[0, 0]],
        y=[points[0, 1]],
        z=[points[0, 2]],
        mode="markers",
        name="path start",
        marker=dict(color="green", size=5),
    )
)
fig.add_trace(
    go.Scatter3d(
        x=[points[-1, 0]],
        y=[points[-1, 1]],
        z=[points[-1, 2]],
        mode="markers",
        name="path end",
        marker=dict(color="red", size=5, symbol="diamond"),
    )
)

fig.update_layout(
    title="Closed profiling example",
    scene=dict(
        xaxis_title="X",
        yaxis_title="Y",
        zaxis_title="Z",
        aspectmode="data",
    ),
)

fig.show()
