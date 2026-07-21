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
  const material = new THREE.MeshStandardMaterial({
    color: STOCK_COLOR,
    roughness: 0.72,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  const light = new THREE.DirectionalLight(0xffffff, 1.2);
  light.position.set(90, -70, 120);
  mesh.add(new THREE.AmbientLight(0xffffff, 1.1), light, light.target);
  mesh.position.copy(center);
  mesh.updateMatrixWorld(true);
  return mesh;
}
