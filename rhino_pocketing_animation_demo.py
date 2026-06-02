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
from rhino_renderer import encode_geometry_to_string
from rhino_renderer import encode_polyline_from_points
from rhino_renderer import reset_rhino_environment
from rhino_renderer.action import RGBColor
from swept_volume_simulation import simulate_swept_milling_frames


GROUP_ID = "opencam-rhino-pocket-animation-demo"
ANIMATION_ID = "opencam-pocket-animation"
ANIMATION_NAME = "Pocketing simulation"
BOUNDARY_OBJECT_ID = "selected-pocket-boundary"
STOCK_PROMPT = "Select one Rhino mesh that represents the stock"
FACE_PROMPT = "Select one Brep face to generate a pocketing operation"
PROMPT_TIMEOUT_SECONDS = 45.0
MAX_ANIMATION_FRAMES = 60

TOOL_DIAMETER = 6.35
CUTTING_HEIGHT = 12.0
MAX_DEPTH_OF_CUT = 1.5
Z_STEP_HEIGHT = 10.0
STEPOVER = 25.0
FEEDRATE = 500.0
RPM = 12000
CLEARANCE_PLANE_HEIGHT = 25.4
STOCK_TO_LEAVE = 0.0

CUT_PATH_COLOR = RGBColor(red=29, green=78, blue=216)
CLEARANCE_PATH_COLOR = RGBColor(red=220, green=38, blue=38)
BOUNDARY_COLOR = RGBColor(red=22, green=163, blue=74)
STOCK_FRAME_COLOR = RGBColor(red=251, green=146, blue=60)
TOOL_FRAME_COLOR = RGBColor(red=59, green=130, blue=246)


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
        raise ValueError("Selected Rhino mesh is empty.")

    return mesh


def trimesh_to_rhino_mesh(mesh):
    rhino_mesh = rhino3dm.Mesh()

    for x, y, z in mesh.vertices:
        rhino_mesh.Vertices.Add(float(x), float(y), float(z))

    for a, b, c in mesh.faces:
        rhino_mesh.Faces.AddFace(int(a), int(b), int(c))

    return rhino_mesh


def mesh_bytes_to_trimesh(mesh_bytes, file_type):
    mesh = trimesh.load(io.BytesIO(mesh_bytes), file_type=file_type, force="mesh")
    if mesh is None or mesh.is_empty:
        raise ValueError("Simulation returned an empty mesh frame.")
    return mesh


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
        raise ValueError("Selected face outer loop could not be converted to a polyline.")

    points = [
        (float(polyline[i].X), float(polyline[i].Y), float(polyline[i].Z))
        for i in range(len(polyline))
    ]
    if len(points) < 4:
        raise ValueError("Selected face outer loop must contain at least 4 polyline points.")

    if point_distance(points[0], points[-1]) > 1e-9:
        raise ValueError("Selected face outer loop must be closed.")

    return points


def z_level_from_curve_points(points):
    z_level = points[0][2]
    for _, _, z in points[1:]:
        if abs(z - z_level) > 1e-9:
            raise ValueError("Selected Brep face outer loop must be planar in Z for 2.5D pocketing.")
    return float(z_level)


def polygon_from_curve_points(points):
    polygon = Polygon([(x, y) for x, y, _ in points[:-1]])
    if polygon.is_empty:
        raise ValueError("Selected face outer loop produced an empty XY pocket boundary.")

    if not polygon.is_valid:
        polygon = polygon.buffer(0)

    if polygon.is_empty:
        raise ValueError("Selected face outer loop could not be repaired into a valid pocket boundary.")

    if not isinstance(polygon, Polygon):
        polygon = max(polygon.geoms, key=lambda candidate: candidate.area)

    return polygon


def closed_polyline_from_polygon(polygon):
    return ClosedPolyline(
        vertices=[Point2D(x=float(x), y=float(y)) for x, y in polygon.exterior.coords]
    )


def build_pocket_operation(polygon, stock_mesh, z_min):
    bounds = stock_mesh.bounds
    z_max = float(bounds[1][2])

    if CLEARANCE_PLANE_HEIGHT <= z_max:
        raise ValueError(
            "Default clearance plane height is below the stock top. "
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
    return ToolpathOperation(tool=engine.tool, paths=engine.process()), z_max


def prompt_stock_mesh(client):
    original_timeout_seconds = client.timeout_seconds
    client.timeout_seconds = PROMPT_TIMEOUT_SECONDS
    try:
        return client.prompt_select_geometry(
            prompt=STOCK_PROMPT,
            object_type="mesh",
            require_enter=True,
        )
    finally:
        client.timeout_seconds = original_timeout_seconds


def prompt_face_outer_loop(client):
    original_timeout_seconds = client.timeout_seconds
    client.timeout_seconds = PROMPT_TIMEOUT_SECONDS
    try:
        return client.prompt_select_brep_face_outer_loop(prompt=FACE_PROMPT)
    finally:
        client.timeout_seconds = original_timeout_seconds


def display_boundary(client, points):
    client.run_action(
        ConduitAction(
            group_id=GROUP_ID,
            object_id=BOUNDARY_OBJECT_ID,
            action="upsert",
            geometry=ConduitGeometry(
                type="polyline",
                geometry_string=encode_polyline_from_points(points),
                style=ObjectStyle(color=BOUNDARY_COLOR, line_width=3),
            ),
        )
    )


def display_operation_paths(client, operation):
    for index, path in enumerate(operation.paths, start=1):
        points = [
            (float(location.x), float(location.y), float(location.z))
            for location in path.locations
        ]
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
                    style=ObjectStyle(color=color, line_width=2),
                ),
            )
        )


def sample_frames(frames, max_frames):
    if len(frames) <= max_frames:
        return frames

    sampled = []
    used_indices = set()
    for slot in range(max_frames):
        index = round(slot * (len(frames) - 1) / (max_frames - 1))
        if index in used_indices:
            continue
        sampled.append(frames[index])
        used_indices.add(index)
    return sampled


def build_animation_frames(tool_mesh_template, simulation_frames):
    animation_frames = []
    for frame in simulation_frames:
        stock_mesh = trimesh_to_rhino_mesh(mesh_bytes_to_trimesh(frame.mesh_bytes, "glb"))

        tool_mesh = tool_mesh_template.copy()
        tool_mesh.apply_translation(
            [
                float(frame.tool_position.x),
                float(frame.tool_position.y),
                float(frame.tool_position.z),
            ]
        )
        tool_rhino_mesh = trimesh_to_rhino_mesh(tool_mesh)

        animation_frames.append(
            [
                {
                    "object_id": "stock",
                    "mesh": stock_mesh,
                    "style": MeshObjectStyle(
                        color=STOCK_FRAME_COLOR,
                        opacity=0.95,
                        line_width=2,
                        display="shaded",
                        show_edges=True,
                        sharp_edge_angle_degrees=4.0,
                        include_naked_edges=True,
                    ),
                },
                {
                    "object_id": "tool",
                    "mesh": tool_rhino_mesh,
                    "style": MeshObjectStyle(
                        color=TOOL_FRAME_COLOR,
                        opacity=0.9,
                        line_width=1,
                        display="shaded",
                        show_edges=True,
                        sharp_edge_angle_degrees=10.0,
                        include_naked_edges=True,
                    ),
                },
            ]
        )

    return animation_frames


def main():
    reset_rhino_environment()

    document_path = current_document_path()
    if not document_path:
        raise RuntimeError("Could not determine active Rhino document path.")

    client = FileClient(file_path=document_path, group_ids=[GROUP_ID])
    client.run_action(ConduitAction(group_id=GROUP_ID, action="delete"))
    client.delete_animation(ANIMATION_ID)

    selected_stock_mesh = prompt_stock_mesh(client)
    if selected_stock_mesh is None:
        raise SystemExit("No stock mesh returned from Rhino.")

    selected_face_outer_loop = prompt_face_outer_loop(client)
    if selected_face_outer_loop is None:
        raise SystemExit("No Brep face outer loop returned from Rhino.")

    stock_mesh = rhino_mesh_to_trimesh(selected_stock_mesh)
    boundary_points = curve_points_from_geometry(selected_face_outer_loop)
    z_min = z_level_from_curve_points(boundary_points)
    pocket_polygon = polygon_from_curve_points(boundary_points)
    operation, z_max = build_pocket_operation(pocket_polygon, stock_mesh, z_min)

    tool_mesh_bytes, simulation_frames = simulate_swept_milling_frames(
        stock_mesh.export(file_type="stl"),
        operation,
    )
    tool_mesh_template = mesh_bytes_to_trimesh(tool_mesh_bytes, "glb")
    sampled_frames = sample_frames(simulation_frames, MAX_ANIMATION_FRAMES)
    animation_frames = build_animation_frames(tool_mesh_template, sampled_frames)

    display_boundary(client, boundary_points)
    display_operation_paths(client, operation)
    client.send_animation(
        animation_id=ANIMATION_ID,
        name=ANIMATION_NAME,
        frames=animation_frames,
    )

    print("Selected stock mesh successfully.")
    print(f"Stock mesh vertices: {len(stock_mesh.vertices)}")
    print(f"Stock mesh faces: {len(stock_mesh.faces)}")
    print(f"Pocket area: {float(pocket_polygon.area):.3f} mm^2")
    print(f"Operation z range: {z_min:.3f} to {z_max:.3f} mm")
    print(f"Generated toolpaths: {len(operation.paths)}")
    print(f"Simulation frames generated: {len(simulation_frames)}")
    print(f"Animation frames sent: {len(animation_frames)}")
    print("Sent pocketing animation to the Rhino Renderer plugin panel.")


if __name__ == "__main__":
    main()
