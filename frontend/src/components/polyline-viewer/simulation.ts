import * as THREE from "three";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { DISPLAY_SHADING_CREASE_ANGLE_DEGREES, STOCK_COLOR } from "./constants";

export function createSimulationStockMesh(bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const geometry = new THREE.BoxGeometry(
    Math.max(size.x, 0.001),
    Math.max(size.y, 0.001),
    Math.max(size.z, 0.001),
  );
  const material = new THREE.MeshBasicMaterial({
    color: STOCK_COLOR,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.copy(center);
  mesh.updateMatrixWorld(true);
  return mesh;
}

export function createBaseSimulationCylinderGeometry() {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1, false);
  geometry.rotateX(Math.PI / 2);

  const creasedGeometry = toCreasedNormals(
    geometry,
    THREE.MathUtils.degToRad(DISPLAY_SHADING_CREASE_ANGLE_DEGREES),
  );
  creasedGeometry.computeBoundingBox();
  creasedGeometry.computeBoundingSphere();
  return creasedGeometry;
}
