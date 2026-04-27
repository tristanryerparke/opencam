import base64
import io

import rhino3dm
import trimesh
from shapely.geometry import Polygon

from models import ClosedPolyline, Point2D, Tool, ToolpathOperation
from pocketing import ClosedPocketingEngine
from rhino_renderer import ConduitAction
from rhino_renderer import ConduitGeometry
from rhino_renderer import FileClient
from rhino_renderer import MeshObjectStyle
from rhino_renderer import ObjectStyle
from rhino_renderer import current_document_path
from rhino_renderer.action import RGBColor
from rhino_renderer import encode_geometry_to_string
from rhino_renderer import encode_polyline_from_points
from rhino_renderer import reset_rhino_environment
from swept_volume_simulation import decode_mesh_data_url, simulate_swept_milling


GROUP_ID = "opencam-rhino-outer-profile-demo"
SIMULATION_OBJECT_ID = "opencam-rhino-outer-profile-demo-milled-stock"
DRIVE_CURVE_OBJECT_ID = "opencam-rhino-outer-profile-demo-drive-curve"
STOCK_PROMPT = "Select one polysurface that represents the stock"
CURVE_PROMPT = "Select one closed curve for 2D pocketing"
MESH_MODE = "smooth"
PROMPT_TIMEOUT_SECONDS = 45.0

TOOL_DIAMETER = 6.35
CUTTING_HEIGHT = 12.0
MAX_DEPTH_OF_CUT = 1.5
Z_STEP_HEIGHT = 10.0
STEPOVER = 25.0
FEEDRATE = 500.0
RPM = 12000
CLEARANCE_PLANE_HEIGHT = 25.4
STOCK_TO_LEAVE = 0

CUT_PATH_COLOR = RGBColor(red=29, green=78, blue=216)
CLEARANCE_PATH_COLOR = RGBColor(red=220, green=38, blue=38)
DRIVE_CURVE_COLOR = RGBColor(red=22, green=163, blue=74)
MILLED_MESH_COLOR = RGBColor(red=251, green=146, blue=60)


def rhino_mesh_to_trimesh(rhino_mesh):
    vertices = []
    for vertex in rhino_mesh.Vertices:
        vertices.append([float(vertex.X), float(vertex.Y), float(vertex.Z)])

    faces = []
    for face in rhino_mesh.Faces:
        a, b, c, d = int(face[0]), int(face[1]), int(face[2]), int(face[3])
        if c == d:
            faces.append([a, b, c])
        else:
            faces.append([a, b, c])
            faces.append([a, c, d])

    mesh = trimesh.Trimesh(vertices=vertices, faces=faces, process=False)
    if mesh.is_empty:
        raise ValueError("Selected Rhino polysurface produced an empty mesh.")

    return mesh


def trimesh_to_rhino_mesh(mesh):
    rhino_mesh = rhino3dm.Mesh()

    for x, y, z in mesh.vertices:
        rhino_mesh.Vertices.Add(float(x), float(y), float(z))

    for a, b, c in mesh.faces:
        rhino_mesh.Faces.AddFace(int(a), int(b), int(c))

    return rhino_mesh


def mesh_to_data_url(mesh):
    stl_bytes = mesh.export(file_type="stl")
    encoded = base64.b64encode(stl_bytes).decode("ascii")
    return "data:model/stl;base64," + encoded


def point_distance(a, b):
    dx = a[0] - b[0]
    dy = a[1] - b[1]
    dz = a[2] - b[2]
    return (dx * dx + dy * dy + dz * dz) ** 0.5


def curve_points_from_geometry(geometry):
    polyline = None
    if hasattr(geometry, "TryGetPolyline"):
        polyline = geometry.TryGetPolyline()
    if polyline is None and hasattr(geometry, "ToPolyline"):
        polyline = geometry.ToPolyline()

    if polyline is None:
        raise ValueError("Selected curve could not be converted to a polyline.")

    points = [
        (float(polyline[i].X), float(polyline[i].Y), float(polyline[i].Z))
        for i in range(len(polyline))
    ]
    if len(points) < 4:
        raise ValueError("Selected curve must contain at least 4 polyline points.")

    if point_distance(points[0], points[-1]) > 1e-9:
        raise ValueError("Selected curve must be closed.")

    return points


def z_level_from_curve_points(points):
    z_level = points[0][2]
    for _, _, z in points[1:]:
        if abs(z - z_level) > 1e-9:
            raise ValueError("Selected curve must be planar in Z.")
    return float(z_level)


def polygon_from_curve_points(points):
    polygon = Polygon([(x, y) for x, y, _ in points[:-1]])
    if polygon.is_empty:
        raise ValueError("Selected curve produced an empty XY pocket boundary.")

    if not polygon.is_valid:
        polygon = polygon.buffer(0)

    if polygon.is_empty:
        raise ValueError("Selected curve could not be repaired into a valid pocket boundary.")

    if not isinstance(polygon, Polygon):
        polygon = max(polygon.geoms, key=lambda candidate: candidate.area)

    return polygon


def closed_polyline_from_polygon(polygon):
    vertices = []
    for x, y in polygon.exterior.coords:
        vertices.append(Point2D(x=float(x), y=float(y)))
    return ClosedPolyline(vertices=vertices)


def build_pocket_operation(polygon, mesh, z_min):
    bounds = mesh.bounds
    z_max = float(bounds[1][2])

    if CLEARANCE_PLANE_HEIGHT <= z_max:
        raise ValueError(
            "Default clearance plane height is below the mesh top. "
            "Increase CLEARANCE_PLANE_HEIGHT before running this demo."
        )

    engine = ClosedPocketingEngine(
        ring=closed_polyline_from_polygon(polygon),
        tool=Tool(
            diameter=TOOL_DIAMETER,
            cutting_height=CUTTING_HEIGHT,
            max_depth_of_cut=MAX_DEPTH_OF_CUT,
        ),
        feedrate=FEEDRATE,
        rpm=RPM,
        z_bounds=(z_min, z_max),
        z_step_height=Z_STEP_HEIGHT,
        stepover=STEPOVER,
        clearance_plane_height=CLEARANCE_PLANE_HEIGHT,
        stock_to_leave=STOCK_TO_LEAVE,
    )

    return ToolpathOperation(tool=engine.tool, paths=engine.process()), z_min, z_max


def decode_data_url_to_trimesh(mesh_data_url):
    stl_bytes = decode_mesh_data_url(mesh_data_url)
    mesh = trimesh.load(io.BytesIO(stl_bytes), file_type="stl", force="mesh")
    if mesh is None or mesh.is_empty:
        raise ValueError("Swept milling simulation returned an empty mesh.")
    return mesh


def display_drive_curve(client, points):
    client.run_action(
        ConduitAction(
            group_id=GROUP_ID,
            object_id=DRIVE_CURVE_OBJECT_ID,
            action="upsert",
            geometry=ConduitGeometry(
                type="polyline",
                geometry_string=encode_polyline_from_points(points),
                style=ObjectStyle(
                    color=DRIVE_CURVE_COLOR,
                    line_width=2,
                ),
            ),
        )
    )


def display_operation_paths(client, operation):
    for index, path in enumerate(operation.paths, start=1):
        points = []
        for location in path.locations:
            points.append((float(location.x), float(location.y), float(location.z)))

        if len(points) < 2:
            continue

        color = CUT_PATH_COLOR if path.kind == "cut" else CLEARANCE_PATH_COLOR
        client.run_action(
            ConduitAction(
                group_id=GROUP_ID,
                object_id=f"toolpath-{index}",
                action="upsert",
                geometry=ConduitGeometry(
                    type="polyline",
                    geometry_string=encode_polyline_from_points(points),
                    style=ObjectStyle(
                        color=color,
                        line_width=3,
                    ),
                ),
            )
        )


def display_simulation_mesh(client, mesh):
    rhino_mesh = trimesh_to_rhino_mesh(mesh)
    client.run_action(
        ConduitAction(
            group_id=GROUP_ID,
            object_id=SIMULATION_OBJECT_ID,
            action="upsert",
            geometry=ConduitGeometry(
                type="mesh",
                geometry_string=encode_geometry_to_string(rhino_mesh),
                style=MeshObjectStyle(
                    color=MILLED_MESH_COLOR,
                    opacity=1.0,
                    line_width=2,
                    display="shaded",
                    show_edges=True,
                    sharp_edge_angle_degrees=4.0,
                    include_naked_edges=True,
                ),
            ),
        )
    )


def prompt_polysurface_mesh(client):
    original_timeout_seconds = client.timeout_seconds
    client.timeout_seconds = PROMPT_TIMEOUT_SECONDS
    try:
        return client.prompt_select_geometry(
            prompt=STOCK_PROMPT,
            object_type="polysurface",
            mesh_brep=MESH_MODE,
            require_enter=True,
        )
    finally:
        client.timeout_seconds = original_timeout_seconds


def prompt_curve(client):
    original_timeout_seconds = client.timeout_seconds
    client.timeout_seconds = PROMPT_TIMEOUT_SECONDS
    try:
        return client.prompt_select_geometry(
            prompt=CURVE_PROMPT,
            object_type="curve",
            require_enter=True,
        )
    finally:
        client.timeout_seconds = original_timeout_seconds


def main():
    reset_rhino_environment()

    document_path = current_document_path()
    if not document_path:
        raise RuntimeError("Could not determine active Rhino document path.")

    client = FileClient(file_path=document_path, group_ids=[GROUP_ID])
    client.run_action(ConduitAction(group_id=GROUP_ID, action="delete"))

    selected_rhino_mesh = prompt_polysurface_mesh(client)
    if selected_rhino_mesh is None:
        raise SystemExit("No stock polysurface returned from Rhino.")

    selected_curve = prompt_curve(client)
    if selected_curve is None:
        raise SystemExit("No pocket curve returned from Rhino.")

    stock_mesh = rhino_mesh_to_trimesh(selected_rhino_mesh)
    curve_points = curve_points_from_geometry(selected_curve)
    z_min = z_level_from_curve_points(curve_points)
    pocket_polygon = polygon_from_curve_points(curve_points)
    operation, z_min, z_max = build_pocket_operation(pocket_polygon, stock_mesh, z_min)

    stock_mesh_data_url = mesh_to_data_url(stock_mesh)
    simulated_mesh_data_url = simulate_swept_milling(stock_mesh_data_url, operation)
    simulated_mesh = decode_data_url_to_trimesh(simulated_mesh_data_url)

    display_drive_curve(client, curve_points)
    display_operation_paths(client, operation)
    display_simulation_mesh(client, simulated_mesh)

    print("Selected stock polysurface meshed successfully.")
    print(f"Stock mesh vertices: {len(stock_mesh.vertices)}")
    print(f"Stock mesh faces: {len(stock_mesh.faces)}")
    print(f"Pocket area: {float(pocket_polygon.area):.3f} mm^2")
    print(f"Operation z range: {z_min:.3f} to {z_max:.3f} mm")
    print(f"Generated paths: {len(operation.paths)}")
    print("Displayed 2D pocket toolpaths and milled stock result in Rhino.")


if __name__ == "__main__":
    main()
