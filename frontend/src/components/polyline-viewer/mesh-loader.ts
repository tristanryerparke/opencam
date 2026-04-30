import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export async function loadMeshGeometry(meshUrl: string) {
  const response = await fetch(meshUrl);

  if (!response.ok) {
    throw new Error(`Failed to load mesh (${response.status}).`);
  }

  const buffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") ?? "";
  const normalizedUrl = meshUrl.toLowerCase();
  const isGlb = contentType.includes("model/gltf-binary") || normalizedUrl.endsWith(".glb");

  if (!isGlb) {
    return new STLLoader().parse(buffer);
  }

  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => {
    new GLTFLoader().parse(buffer, "", resolve, reject);
  });

  gltf.scene.updateMatrixWorld(true);
  const geometries: THREE.BufferGeometry[] = [];

  gltf.scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    const geometry = object.geometry.clone();
    geometry.applyMatrix4(object.matrixWorld);
    geometries.push(geometry);
  });

  if (geometries.length === 0) {
    throw new Error("Loaded GLB does not contain a mesh.");
  }

  if (geometries.length === 1) {
    return geometries[0];
  }

  const mergedGeometry = mergeGeometries(geometries, false);
  geometries.forEach((geometry) => geometry.dispose());

  if (!mergedGeometry) {
    throw new Error("Unable to merge GLB mesh geometry.");
  }

  return mergedGeometry;
}
