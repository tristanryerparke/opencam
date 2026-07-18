import * as THREE from "three";
import type { OcctReadResult } from "occt-import-js";
import type { MeshFaceSelection, PolylinePoint } from "./types";

export const STEP_READ_PARAMS = {
  linearUnit: "millimeter" as const,
  linearDeflectionType: "bounding_box_ratio" as const,
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

export type StepFaceRange = {
  meshIndex: number;
  faceIndex: number;
  firstTriangle: number;
  lastTriangleExclusive: number;
};

export type StepEdgeLoop = {
  id: string;
  faceIndex: number;
  loopIndex: number;
  mesh: THREE.Mesh;
  positions: number[];
  boundaryLoop: ReadonlyArray<PolylinePoint>;
  planeZ: number;
};

function pointKey(point: THREE.Vector3) {
  return `${point.x.toFixed(6)},${point.y.toFixed(6)},${point.z.toFixed(6)}`;
}

function getPointFromKey(key: string): PolylinePoint {
  const [x = 0, y = 0, z = 0] = key.split(",").map(Number);
  return [x, y, z] as const;
}

export function isStepFileName(name: string | null | undefined) {
  return /\.st(?:ep|p)(?:$|[?#])/i.test(name ?? "");
}

export function isStepBuffer(buffer: ArrayBuffer) {
  const header = new TextDecoder().decode(buffer.slice(0, 256)).toUpperCase();
  return header.includes("ISO-10303-21") || header.includes("STEP");
}

export function buildStepGeometry(result: OcctReadResult) {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const faceRanges: StepFaceRange[] = [];

  for (const [meshIndex, mesh] of (result.meshes ?? []).entries()) {
    const meshPositions = mesh.attributes?.position?.array;
    const meshIndices = mesh.index?.array;
    if (!meshPositions?.length || !meshIndices?.length) {
      continue;
    }

    const vertexOffset = positions.length / 3;
    const triangleOffset = indices.length / 3;
    positions.push(...meshPositions);
    indices.push(...meshIndices.map((index) => index + vertexOffset));

    const meshNormals = mesh.attributes?.normal?.array;
    if (meshNormals?.length === meshPositions.length) {
      normals.push(...meshNormals);
    }

    const triangleCount = Math.floor(meshIndices.length / 3);
    for (const [faceIndex, face] of (mesh.brep_faces ?? []).entries()) {
      const firstTriangle = triangleOffset + Math.max(0, Math.min(face.first, triangleCount));
      const lastTriangleExclusive = triangleOffset + Math.max(0, Math.min(face.last + 1, triangleCount));
      if (lastTriangleExclusive > firstTriangle) {
        faceRanges.push({ meshIndex, faceIndex, firstTriangle, lastTriangleExclusive });
      }
    }
  }

  if (positions.length === 0 || indices.length === 0) {
    throw new Error("STEP file loaded, but no mesh triangles were returned.");
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(indices), 1));
  if (normals.length === positions.length) {
    geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  } else {
    geometry.computeVertexNormals();
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData.stepFaceRanges = faceRanges;
  return geometry;
}

export function buildStepEdgeLines(
  geometry: THREE.BufferGeometry,
  faceRanges: ReadonlyArray<StepFaceRange>,
  color: number,
) {
  const index = geometry.getIndex();
  const position = geometry.getAttribute("position");
  if (!index || !position) {
    return null;
  }

  const edgePositions: number[] = [];
  for (const range of faceRanges) {
    const faceGeometry = new THREE.BufferGeometry();
    faceGeometry.setAttribute("position", position);
    faceGeometry.setIndex(new THREE.BufferAttribute(
      index.array.slice(range.firstTriangle * 3, range.lastTriangleExclusive * 3),
      1,
    ));

    const edgesGeometry = new THREE.EdgesGeometry(faceGeometry, 180);
    const edgesPosition = edgesGeometry.getAttribute("position");
    edgePositions.push(...Array.from(edgesPosition.array as ArrayLike<number>));
    edgesGeometry.dispose();
    faceGeometry.dispose();
  }

  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute("position", new THREE.Float32BufferAttribute(edgePositions, 3));
  const lines = new THREE.LineSegments(
    edgeGeometry,
    new THREE.LineBasicMaterial({ color, depthTest: true, depthWrite: false }),
  );
  lines.renderOrder = 2;
  lines.frustumCulled = false;
  return lines;
}

function isXyPlanarFace(mesh: THREE.Mesh, range: StepFaceRange) {
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

function orderLoop(component: number[], segments: { start: THREE.Vector3; end: THREE.Vector3 }[]) {
  const adjacency = new Map<string, string[]>();
  for (const segmentIndex of component) {
    const segment = segments[segmentIndex];
    const start = pointKey(segment.start);
    const end = pointKey(segment.end);
    adjacency.set(start, [...(adjacency.get(start) ?? []), end]);
    adjacency.set(end, [...(adjacency.get(end) ?? []), start]);
  }

  if ([...adjacency.values()].some((neighbors) => neighbors.length !== 2)) {
    return null;
  }

  const startKey = [...adjacency.keys()][0];
  const orderedKeys = [startKey];
  let previous: string | null = null;
  let current = startKey;

  for (let guard = 0; guard <= adjacency.size; guard += 1) {
    const neighbors = adjacency.get(current) ?? [];
    const next = neighbors.find((neighbor) => neighbor !== previous) ?? neighbors[0];
    if (!next) {
      return null;
    }

    orderedKeys.push(next);
    if (next === startKey) {
      return orderedKeys.map(getPointFromKey);
    }

    previous = current;
    current = next;
  }

  return null;
}

export function getStepEdgeLoops(mesh: THREE.Mesh) {
  const faceRanges = mesh.userData.stepFaceRanges as StepFaceRange[] | undefined;
  const position = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.getIndex();
  if (!faceRanges?.length || !position || !index) {
    return [];
  }

  const loops: StepEdgeLoop[] = [];
  for (const range of faceRanges) {
    if (!isXyPlanarFace(mesh, range)) {
      continue;
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
      start: new THREE.Vector3().fromBufferAttribute(edgesPosition, segmentIndex * 2),
      end: new THREE.Vector3().fromBufferAttribute(edgesPosition, segmentIndex * 2 + 1),
    }));
    const pointToSegments = new Map<string, number[]>();
    for (const [segmentIndex, segment] of segments.entries()) {
      for (const key of [pointKey(segment.start), pointKey(segment.end)]) {
        pointToSegments.set(key, [...(pointToSegments.get(key) ?? []), segmentIndex]);
      }
    }

    const visited = new Set<number>();
    let loopIndex = 0;
    for (const [segmentIndex] of segments.entries()) {
      if (visited.has(segmentIndex)) {
        continue;
      }

      const stack = [segmentIndex];
      const component: number[] = [];
      visited.add(segmentIndex);
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

      const boundaryLoop = orderLoop(component, segments);
      if (!boundaryLoop || boundaryLoop.length < 4) {
        continue;
      }

      const positions: number[] = [];
      for (const currentIndex of component) {
        const current = segments[currentIndex];
        positions.push(current.start.x, current.start.y, current.start.z, current.end.x, current.end.y, current.end.z);
      }

      loops.push({
        id: `step-face-${range.faceIndex}-loop-${loopIndex}`,
        faceIndex: range.faceIndex,
        loopIndex,
        mesh,
        positions,
        boundaryLoop,
        planeZ: boundaryLoop[0][2],
      });
      loopIndex += 1;
    }

    edgesGeometry.dispose();
    faceGeometry.dispose();
  }

  return loops;
}

export function stepEdgeLoopToSelection(loop: StepEdgeLoop): MeshFaceSelection {
  return {
    id: loop.id,
    label: `STEP loop ${loop.loopIndex + 1}`,
    normal: [0, 0, 1],
    triangleIndices: [],
    triangleCount: 0,
    area: 0,
    isParallelToXY: true,
    planeZ: loop.planeZ,
    boundaryLoop: loop.boundaryLoop,
    validationError: null,
  };
}
