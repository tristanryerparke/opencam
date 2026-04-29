import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import {
  CAMERA_FAR_RADIUS_MULTIPLIER,
  CAMERA_MAX_DISTANCE_MULTIPLIER,
  CAMERA_NEAR_DISTANCE_FACTOR,
  CAMERA_NEAR_SCENE_FACTOR,
  DEFAULT_SCENE_BOUNDS,
  MAX_OVERLAY_LIFT,
  MIN_OVERLAY_LIFT,
  OVERLAY_LIFT_FACTOR,
} from "./constants";
import type { PolylineDefinition } from "./types";

export function getPolylineBounds(polylines: ReadonlyArray<PolylineDefinition>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const polyline of polylines) {
    for (const [x, y, z] of polyline.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  );
}

export function getSceneBounds(
  polylines: ReadonlyArray<PolylineDefinition>,
  meshBounds?: THREE.Box3 | null,
) {
  const bounds = (meshBounds ?? DEFAULT_SCENE_BOUNDS).clone();
  const polylineBounds = getPolylineBounds(polylines);

  return polylineBounds ? bounds.union(polylineBounds) : bounds;
}

export function getSceneDiagonal(box: THREE.Box3) {
  return box.getSize(new THREE.Vector3()).length();
}

export function getOverlayLift(box: THREE.Box3) {
  return THREE.MathUtils.clamp(
    getSceneDiagonal(box) * OVERLAY_LIFT_FACTOR,
    MIN_OVERLAY_LIFT,
    MAX_OVERLAY_LIFT,
  );
}

export function updateCameraDepthRange(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const size = box.getSize(new THREE.Vector3());
  const sceneRadius = Math.max(size.length() * 0.5, 0.5);
  const distanceToTarget = Math.max(
    camera.position.distanceTo(controls.target),
    sceneRadius * 0.1,
    0.01,
  );
  const near = Math.max(
    0.001,
    distanceToTarget * CAMERA_NEAR_DISTANCE_FACTOR,
    sceneRadius * CAMERA_NEAR_SCENE_FACTOR,
  );
  const far = Math.max(
    near * 10,
    distanceToTarget + sceneRadius * CAMERA_FAR_RADIUS_MULTIPLIER,
  );

  if (Math.abs(camera.near - near) > 1e-6 || Math.abs(camera.far - far) > 1e-3) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

export function fitCameraToBox(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const fovRadians = (camera.fov * Math.PI) / 180;
  const distance = maxDimension / (2 * Math.tan(fovRadians / 2));

  camera.position.set(
    center.x + distance * 1.35,
    center.y - distance * 1.1,
    center.z + distance * 0.9,
  );

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension * 0.0005, 0.01);
  controls.maxDistance = Math.max(maxDimension * CAMERA_MAX_DISTANCE_MULTIPLIER, distance * 2);
  controls.update();

  updateCameraDepthRange(box, camera, controls);
}

export function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (
      child instanceof THREE.Line ||
      child instanceof THREE.Mesh ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

export function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}
