import * as THREE from "three";
import type { OcctMesh, OcctReadResult } from "occt-import-js";

export type StepSceneStats = {
  meshes: number;
  brepFaces: number;
  triangles: number;
  edgeSegments: number;
};

export type SelectedBrepFace = {
  meshIndex: number;
  faceIndex: number;
};

type FaceRange = {
  faceIndex: number;
  firstTriangle: number;
  lastTriangleExclusive: number;
};

const DEFAULT_MESH_COLOR = 0xd1d5db;
const SELECTED_FACE_COLOR = 0xf97316;
const EDGE_COLOR = 0x111827;

function makeMeshMaterial(color = DEFAULT_MESH_COLOR) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.72,
    metalness: 0.02,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
}

function addFaceMaterialGroups(
  geometry: THREE.BufferGeometry,
  occtMesh: OcctMesh,
  defaultMaterial: THREE.MeshStandardMaterial,
  triangleCount: number,
) {
  const brepFaces = occtMesh.brep_faces ?? [];
  if (brepFaces.length === 0) {
    return [defaultMaterial];
  }

  const materials = [defaultMaterial];
  for (const _face of brepFaces) {
    materials.push(makeMeshMaterial());
  }

  let triangleIndex = 0;
  let faceIndex = 0;
  while (triangleIndex < triangleCount) {
    const firstIndex = triangleIndex;
    let lastIndex = triangleCount;
    let materialIndex = 0;

    const face = brepFaces[faceIndex];
    if (face && triangleIndex < face.first) {
      lastIndex = Math.min(face.first, triangleCount);
    } else if (face) {
      lastIndex = Math.min(face.last + 1, triangleCount);
      materialIndex = faceIndex + 1;
      faceIndex += 1;
    }

    geometry.addGroup(firstIndex * 3, (lastIndex - firstIndex) * 3, materialIndex);
    triangleIndex = lastIndex;
  }

  return materials;
}

function getFaceRanges(occtMesh: OcctMesh, triangleCount: number): FaceRange[] {
  return (occtMesh.brep_faces ?? [])
    .map((face, faceIndex) => ({
      faceIndex,
      firstTriangle: Math.max(0, Math.min(face.first, triangleCount)),
      lastTriangleExclusive: Math.max(0, Math.min(face.last + 1, triangleCount)),
    }))
    .filter((range) => range.lastTriangleExclusive > range.firstTriangle);
}

// LDraw-style display: offset the shaded faces, then draw plain 1px LineSegments.
// occt-import-js exposes BREP face triangle ranges, so each face's boundary becomes its edge lines.
function buildEdgeLines(
  geometry: THREE.BufferGeometry,
  index: THREE.BufferAttribute,
  faceRanges: FaceRange[],
  triangleCount: number,
) {
  const ranges = faceRanges.length > 0
    ? faceRanges
    : [{ firstTriangle: 0, lastTriangleExclusive: triangleCount }];
  const edgePositions: number[] = [];
  const position = geometry.getAttribute("position");

  for (const range of ranges) {
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", position);
    faceGeometry.setIndex(new THREE.BufferAttribute(
      index.array.slice(range.firstTriangle * 3, range.lastTriangleExclusive * 3),
      1,
    ));

    const edgesGeometry = new THREE.EdgesGeometry(faceGeometry, faceRanges.length > 0 ? 180 : 30);
    const edgesPosition = edgesGeometry.getAttribute("position");
    edgePositions.push(...Array.from(edgesPosition.array as ArrayLike<number>));

    edgesGeometry.dispose();
    faceGeometry.dispose();
  }

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));

  const lines = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color: EDGE_COLOR }),
  );
  lines.renderOrder = 1;
  return {
    lines,
    edgeSegments: edgePositions.length / 6,
  };
}

function buildMesh(occtMesh: OcctMesh, meshIndex: number) {
  const positions = occtMesh.attributes?.position?.array;
  const indices = occtMesh.index?.array;
  if (!positions || !indices || positions.length === 0 || indices.length === 0) {
    return null;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

  const normals = occtMesh.attributes?.normal?.array;
  if (normals && normals.length === positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  }

  const index = new THREE.BufferAttribute(Uint32Array.from(indices), 1);
  geometry.setIndex(index);
  if (!geometry.getAttribute("normal")) {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  const triangleCount = Math.floor(indices.length / 3);
  const material = makeMeshMaterial();
  const materials = addFaceMaterialGroups(geometry, occtMesh, material, triangleCount);
  const mesh = new THREE.Mesh(geometry, materials.length === 1 ? materials[0] : materials);
  mesh.name = occtMesh.name ?? "STEP mesh";
  const faceRanges = getFaceRanges(occtMesh, triangleCount);
  mesh.userData.stepMeshIndex = meshIndex;
  mesh.userData.brepFaceRanges = faceRanges;
  mesh.renderOrder = 0;

  const { lines, edgeSegments } = buildEdgeLines(geometry, index, faceRanges, triangleCount);
  lines.name = `${mesh.name} edges`;

  const group = new THREE.Group();
  group.add(mesh, lines);

  return {
    group,
    stats: {
      brepFaces: faceRanges.length,
      triangles: triangleCount,
      edgeSegments,
    },
  };
}

export function buildStepScene(result: OcctReadResult) {
  const group = new THREE.Group();
  group.name = result.root?.name || "STEP model";

  const stats: StepSceneStats = {
    meshes: 0,
    brepFaces: 0,
    triangles: 0,
    edgeSegments: 0,
  };

  for (const [meshIndex, occtMesh] of (result.meshes ?? []).entries()) {
    const built = buildMesh(occtMesh, meshIndex);
    if (!built) {
      continue;
    }

    group.add(built.group);
    stats.meshes += 1;
    stats.brepFaces += built.stats.brepFaces;
    stats.triangles += built.stats.triangles;
    stats.edgeSegments += built.stats.edgeSegments;
  }

  return { group, stats };
}

export function setSelectedBrepFace(root: THREE.Object3D, selected: SelectedBrepFace | null) {
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || typeof child.userData.stepMeshIndex !== "number") {
      return;
    }

    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(DEFAULT_MESH_COLOR);
      }
    }

    if (selected?.meshIndex !== child.userData.stepMeshIndex) {
      return;
    }

    const material = materials[selected.faceIndex + 1];
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set(SELECTED_FACE_COLOR);
    }
  });
}

export function getSelectedBrepFaceFromIntersection(
  intersection: THREE.Intersection,
): SelectedBrepFace | null {
  if (!(intersection.object instanceof THREE.Mesh) || intersection.faceIndex == null) {
    return null;
  }

  const meshIndex = intersection.object.userData.stepMeshIndex;
  const faceRanges = intersection.object.userData.brepFaceRanges as FaceRange[] | undefined;
  if (typeof meshIndex !== "number" || !faceRanges?.length) {
    return null;
  }

  const range = faceRanges.find(
    (candidate) =>
      intersection.faceIndex != null &&
      intersection.faceIndex >= candidate.firstTriangle &&
      intersection.faceIndex < candidate.lastTriangleExclusive,
  );

  return range ? { meshIndex, faceIndex: range.faceIndex } : null;
}

export function disposeObject(object: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();

  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh || child instanceof THREE.LineSegments)) {
      return;
    }

    if (!geometries.has(child.geometry)) {
      child.geometry.dispose();
      geometries.add(child.geometry);
    }

    const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of childMaterials) {
      if (!materials.has(material)) {
        material.dispose();
        materials.add(material);
      }
    }
  });
}
