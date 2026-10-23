import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type CachedMeshPayload = {
  vertices: number[][];
  faces: number[][];
  sourceFaceIds?: number[] | null;
};

function buildCachedMeshGeometry(payload: CachedMeshPayload) {
  if (!payload.vertices?.length || !payload.faces?.length) {
    throw new Error("Cached mesh contains no geometry.");
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(payload.vertices.flat(), 3),
  );
  geometry.setIndex(new THREE.BufferAttribute(
    Uint32Array.from(payload.faces.flat()),
    1,
  ));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  if (payload.sourceFaceIds?.length === payload.faces.length) {
    const stepFaceRanges = [];
    let rangeStart = 0;
    for (let triangle = 1; triangle <= payload.sourceFaceIds.length; triangle += 1) {
      const previousFaceId = payload.sourceFaceIds[rangeStart];
      if (triangle < payload.sourceFaceIds.length && payload.sourceFaceIds[triangle] === previousFaceId) {
        continue;
      }

      stepFaceRanges.push({
        meshIndex: 0,
        faceIndex: previousFaceId,
        firstTriangle: rangeStart,
        lastTriangleExclusive: triangle,
      });
      rangeStart = triangle;
    }
    geometry.userData.stepFaceRanges = stepFaceRanges;
  }

  return geometry;
}

export async function loadMeshGeometry(meshUrl: string) {
  const response = await fetch(meshUrl);

  if (!response.ok) {
    throw new Error(`Failed to load mesh (${response.status}).`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const normalizedUrl = meshUrl.toLowerCase();
  if (contentType.includes("application/json")) {
    return buildCachedMeshGeometry(await response.json() as CachedMeshPayload);
  }

  const buffer = await response.arrayBuffer();
  const isGlb = contentType.includes("model/gltf-binary") || normalizedUrl.endsWith(".glb");

  if (isGlb) {
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

  return new STLLoader().parse(buffer);
}
