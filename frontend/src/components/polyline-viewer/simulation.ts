import * as THREE from "three";

import { STOCK_COLOR } from "./constants";

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
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, false);
  geometry.rotateX(Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}
