import {
  DEFAULT_SCENE_BOUNDS,
  MAX_OVERLAY_LIFT,
  MIN_OVERLAY_LIFT,
  OVERLAY_LIFT_FACTOR,
} from "./constants";
import type { PolylineDefinition } from "./types";

export type Bounds = {
  min: [number, number, number];
  max: [number, number, number];
};

export function cloneBounds(bounds: Bounds): Bounds {
  return { min: [...bounds.min], max: [...bounds.max] };
}

export function unionBounds(bounds: Bounds, other: Bounds): Bounds {
  return {
    min: bounds.min.map((value, index) => Math.min(value, other.min[index])) as Bounds["min"],
    max: bounds.max.map((value, index) => Math.max(value, other.max[index])) as Bounds["max"],
  };
}

export function getPolylineBounds(polylines: ReadonlyArray<PolylineDefinition>): Bounds | null {
  const bounds: Bounds = {
    min: [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    max: [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
  };

  for (const polyline of polylines) {
    for (const point of polyline.points) {
      for (let axis = 0; axis < 3; axis += 1) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
    }
  }

  return Number.isFinite(bounds.min[0]) ? bounds : null;
}

export function getSceneBounds(
  polylines: ReadonlyArray<PolylineDefinition>,
  meshBounds?: Bounds | null,
) {
  const polylineBounds = getPolylineBounds(polylines);
  const bounds = cloneBounds(meshBounds ?? DEFAULT_SCENE_BOUNDS);
  return polylineBounds ? unionBounds(bounds, polylineBounds) : bounds;
}

export function getBoundsSize(bounds: Bounds): [number, number, number] {
  return bounds.max.map((value, index) => value - bounds.min[index]) as [number, number, number];
}

export function getSceneDiagonal(bounds: Bounds) {
  return Math.hypot(...getBoundsSize(bounds));
}

export function getOverlayLift(bounds: Bounds) {
  return Math.min(
    MAX_OVERLAY_LIFT,
    Math.max(MIN_OVERLAY_LIFT, getSceneDiagonal(bounds) * OVERLAY_LIFT_FACTOR),
  );
}
