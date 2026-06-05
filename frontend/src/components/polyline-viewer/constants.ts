import * as THREE from "three";

export const POLYLINE_COLORS = ["#60a5fa", "#f97316", "#22c55e", "#e879f9"] as const;
export const POLYLINE_LINEWIDTH = 2.35;
export const CLEARANCE_POLYLINE_LINEWIDTH = 2.1;
export const MESH_EDGE_LINEWIDTH = 1.5;
export const MESH_DEPTH_OFFSET_FACTOR = 1;
export const MESH_DEPTH_OFFSET_UNITS = 1;
export const OVERLAY_LIFT_FACTOR = 1e-5;
export const MIN_OVERLAY_LIFT = 0.0001;
export const MAX_OVERLAY_LIFT = 0.05;
export const CAMERA_NEAR_DISTANCE_FACTOR = 1e-4;
export const CAMERA_NEAR_SCENE_FACTOR = 1e-5;
export const CAMERA_FAR_RADIUS_MULTIPLIER = 6;
export const CAMERA_MAX_DISTANCE_MULTIPLIER = 14;
export const NORMAL_ALIGNMENT_EPSILON = 0.9999;
export const DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES = 12;
export const DISPLAY_SHADING_CREASE_ANGLE_DEGREES = 35;
export const PLANE_EPSILON = 0.001;
export const STOCK_COLOR = 0xcbd5e1;
export const CUT_SURFACE_COLOR = 0xfb923c;
export const TOOL_PREVIEW_COLOR = 0x6b7280;
export const DEFAULT_SCENE_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-90, -90, 0),
  new THREE.Vector3(110, 90, 90),
);
