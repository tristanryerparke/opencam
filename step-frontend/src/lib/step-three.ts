import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
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

export type SelectedBrepEdgeLoop = SelectedBrepFace & {
  loopIndex: number;
};

export type BrepEdgeLoop = SelectedBrepEdgeLoop & {
  mesh: THREE.Mesh;
  positions: number[];
};

type FaceRange = {
  faceIndex: number;
  firstTriangle: number;
  lastTriangleExclusive: number;
};

const DEFAULT_MESH_COLOR = 0xd1d5db;
const SELECTED_FACE_COLOR = 0xf97316;
const EDGE_COLOR = 0x111827;
const CONTOUR_COLOR = 0x2563eb;
const SELECTED_FACE_EDGE_COLOR = 0x22c55e;
const EDGE_LOOP_SELECTED_COLOR = 0x1e3a8a;
const HOVER_FACE_COLOR = 0xf97316;
const CONTOUR_COUNT = 10;
const CONTOUR_LINEWIDTH = 2;

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
    new THREE.LineBasicMaterial({
      color: EDGE_COLOR,
      depthTest: true,
      depthWrite: false,
    }),
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

function pointKey(point: THREE.Vector3) {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
}

function getMeshAndFaceRange(root: THREE.Object3D, selected: SelectedBrepFace) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && child.userData.stepMeshIndex === selected.meshIndex) {
      meshes.push(child);
    }
  });

  const mesh = meshes[0];
  const faceRanges = mesh?.userData.brepFaceRanges as FaceRange[] | undefined;
  const range = faceRanges?.find((candidate) => candidate.faceIndex === selected.faceIndex);
  return mesh && range ? { mesh, range } : null;
}

function removeSelectedFaceContours(mesh: THREE.Mesh) {
  const contours = mesh.userData.selectedFaceContours as THREE.Object3D | undefined;
  if (!contours) {
    return;
  }

  mesh.remove(contours);
  disposeObject(contours);
  mesh.userData.selectedFaceContours = null;
}

function removeSelectedFaceEdges(mesh: THREE.Mesh) {
  const edges = mesh.userData.selectedFaceEdges as THREE.Object3D | undefined;
  if (!edges) {
    return;
  }

  mesh.remove(edges);
  disposeObject(edges);
  mesh.userData.selectedFaceEdges = null;
}

function pushPlaneIntersection(
  points: THREE.Vector3[],
  a: THREE.Vector3,
  b: THREE.Vector3,
  axis: "x" | "y" | "z",
  value: number,
) {
  const da = a[axis] - value;
  const db = b[axis] - value;
  const eps = 1e-8;

  if (Math.abs(da) < eps && Math.abs(db) < eps) {
    return;
  }
  if (da * db > 0 && Math.abs(da) >= eps && Math.abs(db) >= eps) {
    return;
  }

  const t = Math.abs(da) < eps ? 0 : Math.abs(db) < eps ? 1 : da / (da - db);
  points.push(new THREE.Vector3().lerpVectors(a, b, t));
}

function pushUnique(points: THREE.Vector3[], point: THREE.Vector3) {
  if (!points.some((existing) => existing.distanceToSquared(point) < 1e-12)) {
    points.push(point);
  }
}

function buildSelectedFaceContours(mesh: THREE.Mesh, range: FaceRange) {
  const geometry = mesh.geometry;
  const position = geometry.getAttribute("position");
  const index = geometry.getIndex();
  if (!position || !index) {
    return null;
  }

  const vertices: THREE.Vector3[] = [];
  for (let triangle = range.firstTriangle; triangle < range.lastTriangleExclusive; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      vertices.push(new THREE.Vector3().fromBufferAttribute(position, index.getX(triangle * 3 + corner)));
    }
  }

  const bounds = new THREE.Box3().setFromPoints(vertices);
  const size = bounds.getSize(new THREE.Vector3());
  const axis = size.z > 1e-6 ? "z" : size.x >= size.y ? "x" : "y";
  const min = bounds.min[axis];
  const extent = size[axis];
  if (extent <= 1e-6) {
    return null;
  }

  const contourPositions: number[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();

  for (let contour = 1; contour <= CONTOUR_COUNT; contour += 1) {
    const value = min + (extent * contour) / (CONTOUR_COUNT + 1);

    for (let triangle = range.firstTriangle; triangle < range.lastTriangleExclusive; triangle += 1) {
      a.fromBufferAttribute(position, index.getX(triangle * 3));
      b.fromBufferAttribute(position, index.getX(triangle * 3 + 1));
      c.fromBufferAttribute(position, index.getX(triangle * 3 + 2));

      const intersections: THREE.Vector3[] = [];
      pushPlaneIntersection(intersections, a, b, axis, value);
      pushPlaneIntersection(intersections, b, c, axis, value);
      pushPlaneIntersection(intersections, c, a, axis, value);

      const unique: THREE.Vector3[] = [];
      for (const point of intersections) {
        pushUnique(unique, point);
      }
      if (unique.length >= 2) {
        contourPositions.push(
          unique[0].x,
          unique[0].y,
          unique[0].z,
          unique[1].x,
          unique[1].y,
          unique[1].z,
        );
      }
    }
  }

  if (contourPositions.length === 0) {
    return null;
  }

  const contourGeometry = new LineSegmentsGeometry();
  contourGeometry.setPositions(contourPositions);
  const contours = new LineSegments2(
    contourGeometry,
    new LineMaterial({
      color: CONTOUR_COLOR,
      linewidth: CONTOUR_LINEWIDTH,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  contours.frustumCulled = false;
  contours.renderOrder = 20;
  return contours;
}

export function setSelectedBrepFace(root: THREE.Object3D, selected: SelectedBrepFace | null) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((child) => {
    if (child instanceof THREE.Mesh && typeof child.userData.stepMeshIndex === "number") {
      meshes.push(child);
    }
  });

  for (const mesh of meshes) {
    removeSelectedFaceContours(mesh);
    removeSelectedFaceEdges(mesh);

    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.color.set(DEFAULT_MESH_COLOR);
      }
    }

    if (!selected || selected.meshIndex !== mesh.userData.stepMeshIndex) {
      continue;
    }

    const material = materials[selected.faceIndex + 1];
    if (material instanceof THREE.MeshStandardMaterial) {
      material.color.set(SELECTED_FACE_COLOR);
    }

    const faceRanges = mesh.userData.brepFaceRanges as FaceRange[] | undefined;
    const range = faceRanges?.find((candidate) => candidate.faceIndex === selected.faceIndex);
    const contours = range ? buildSelectedFaceContours(mesh, range) : null;
    if (contours) {
      mesh.add(contours);
      mesh.userData.selectedFaceContours = contours;
    }

    const edgeGroup = new THREE.Group();
    for (const loop of range ? buildBrepFaceEdgeLoops(mesh, range) : []) {
      const line = createBrepEdgeLoopLine(loop, SELECTED_FACE_EDGE_COLOR);
      line.renderOrder = 21;
      edgeGroup.add(line);
    }
    if (edgeGroup.children.length > 0) {
      mesh.add(edgeGroup);
      mesh.userData.selectedFaceEdges = edgeGroup;
    }
  }
}

export function createBrepFaceHoverPreview(root: THREE.Object3D, selected: SelectedBrepFace) {
  const target = getMeshAndFaceRange(root, selected);
  const mesh = target?.mesh;
  const range = target?.range;
  const position = mesh?.geometry.getAttribute("position");
  const normal = mesh?.geometry.getAttribute("normal");
  const index = mesh?.geometry.getIndex();
  if (!mesh || !range || !position || !index) {
    return null;
  }

  const positions: number[] = [];
  const normals: number[] = [];
  for (let triangle = range.firstTriangle; triangle < range.lastTriangleExclusive; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const vertexIndex = index.getX(triangle * 3 + corner);
      positions.push(position.getX(vertexIndex), position.getY(vertexIndex), position.getZ(vertexIndex));
      if (normal) {
        normals.push(normal.getX(vertexIndex), normal.getY(vertexIndex), normal.getZ(vertexIndex));
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (normals.length === positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }

  const preview = new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({
      color: HOVER_FACE_COLOR,
      depthTest: false,
      depthWrite: false,
      opacity: 0.45,
      side: THREE.DoubleSide,
      transparent: true,
    }),
  );
  preview.frustumCulled = false;
  preview.renderOrder = 30;
  return { mesh, preview };
}

function isXyPlanarFace(mesh: THREE.Mesh, range: FaceRange) {
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  if (!position || !index) {
    return false;
  }

  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let triangle = range.firstTriangle; triangle < range.lastTriangleExclusive; triangle += 1) {
    for (let corner = 0; corner < 3; corner += 1) {
      const z = position.getZ(index.getX(triangle * 3 + corner));
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return maxZ - minZ <= 1e-5;
}

function buildBrepFaceEdgeLoops(mesh: THREE.Mesh, range: FaceRange): BrepEdgeLoop[] {
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  const meshIndex = mesh.userData.stepMeshIndex;
  if (!position || !index || typeof meshIndex !== "number") {
    return [];
  }

  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute("position", position);
  faceGeometry.setIndex(new THREE.BufferAttribute(
    index.array.slice(range.firstTriangle * 3, range.lastTriangleExclusive * 3),
    1,
  ));

  const edgesGeometry = new THREE.EdgesGeometry(faceGeometry, 180);
  const edgesPosition = edgesGeometry.getAttribute("position");
  const segments = Array.from({ length: edgesPosition.count / 2 }, (_, segmentIndex) => ({
    segmentIndex,
    start: new THREE.Vector3().fromBufferAttribute(edgesPosition, segmentIndex * 2),
    end: new THREE.Vector3().fromBufferAttribute(edgesPosition, segmentIndex * 2 + 1),
  }));
  const pointToSegments = new Map<string, number[]>();
  for (const segment of segments) {
    for (const key of [pointKey(segment.start), pointKey(segment.end)]) {
      const list = pointToSegments.get(key) ?? [];
      list.push(segment.segmentIndex);
      pointToSegments.set(key, list);
    }
  }

  const visited = new Set<number>();
  const loops: BrepEdgeLoop[] = [];
  for (const segment of segments) {
    if (visited.has(segment.segmentIndex)) {
      continue;
    }

    const stack = [segment.segmentIndex];
    const component: number[] = [];
    visited.add(segment.segmentIndex);
    while (stack.length > 0) {
      const currentIndex = stack.pop();
      if (currentIndex == null) {
        continue;
      }
      component.push(currentIndex);
      const current = segments[currentIndex];
      for (const key of [pointKey(current.start), pointKey(current.end)]) {
        for (const nextIndex of pointToSegments.get(key) ?? []) {
          if (!visited.has(nextIndex)) {
            visited.add(nextIndex);
            stack.push(nextIndex);
          }
        }
      }
    }

    const positions: number[] = [];
    for (const segmentIndex of component) {
      const current = segments[segmentIndex];
      positions.push(current.start.x, current.start.y, current.start.z, current.end.x, current.end.y, current.end.z);
    }
    loops.push({
      mesh,
      meshIndex,
      faceIndex: range.faceIndex,
      loopIndex: loops.length,
      positions,
    });
  }

  edgesGeometry.dispose();
  faceGeometry.dispose();
  return loops;
}

export function getBrepFaceEdgeLoops(root: THREE.Object3D, selected: SelectedBrepFace | null): BrepEdgeLoop[] {
  const target = selected ? getMeshAndFaceRange(root, selected) : null;
  return target ? buildBrepFaceEdgeLoops(target.mesh, target.range) : [];
}

export function getAllBrepEdgeLoops(root: THREE.Object3D): BrepEdgeLoop[] {
  const loops: BrepEdgeLoop[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh) || typeof child.userData.stepMeshIndex !== "number") {
      return;
    }

    for (const range of (child.userData.brepFaceRanges as FaceRange[] | undefined) ?? []) {
      if (isXyPlanarFace(child, range)) {
        loops.push(...buildBrepFaceEdgeLoops(child, range));
      }
    }
  });
  return loops;
}

export function createBrepEdgeLoopLine(loop: BrepEdgeLoop, color = CONTOUR_COLOR) {
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(loop.positions);
  const line = new LineSegments2(
    geometry,
    new LineMaterial({
      color,
      linewidth: CONTOUR_LINEWIDTH,
      depthTest: false,
      depthWrite: false,
      transparent: true,
      opacity: 0.95,
    }),
  );
  line.frustumCulled = false;
  line.renderOrder = 30;
  return line;
}

export function createSelectedBrepEdgeLoopLine(loop: BrepEdgeLoop) {
  return createBrepEdgeLoopLine(loop, EDGE_LOOP_SELECTED_COLOR);
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
