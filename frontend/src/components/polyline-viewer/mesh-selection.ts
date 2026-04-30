import * as THREE from "three";

import { NORMAL_ALIGNMENT_EPSILON, PLANE_EPSILON } from "./constants";
import type { MeshFaceSelection, PolylinePoint } from "./types";

type TriangleData = {
  indices: [number, number, number];
  normal: THREE.Vector3;
  area: number;
};

export type MeshSelectionData = {
  triangles: TriangleData[];
  edgeMap: Map<string, number[]>;
  bounds: THREE.Box3;
};

type BoundaryEdge = {
  start: number;
  end: number;
};

function edgeKey(a: number, b: number) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function getVertex(
  positionAttribute: THREE.BufferAttribute | THREE.InterleavedBufferAttribute,
  index: number,
) {
  return new THREE.Vector3(
    positionAttribute.getX(index),
    positionAttribute.getY(index),
    positionAttribute.getZ(index),
  );
}

export function createMeshSelectionData(
  geometry: THREE.BufferGeometry,
): MeshSelectionData {
  const positionAttribute = geometry.getAttribute("position");
  const indexAttribute = geometry.getIndex();

  if (!positionAttribute || !indexAttribute) {
    throw new Error("Selection geometry must have indexed positions.");
  }

  const triangles: TriangleData[] = [];
  const edgeMap = new Map<string, number[]>();
  const triangleCount = indexAttribute.count / 3;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const a = indexAttribute.getX(triangleIndex * 3);
    const b = indexAttribute.getX(triangleIndex * 3 + 1);
    const c = indexAttribute.getX(triangleIndex * 3 + 2);

    const vertexA = getVertex(positionAttribute, a);
    const vertexB = getVertex(positionAttribute, b);
    const vertexC = getVertex(positionAttribute, c);
    const triangle = new THREE.Triangle(vertexA, vertexB, vertexC);
    const normal = triangle.getNormal(new THREE.Vector3());

    triangles.push({
      indices: [a, b, c],
      normal,
      area: triangle.getArea(),
    });

    const edges: Array<[number, number]> = [
      [a, b],
      [b, c],
      [c, a],
    ];

    for (const [start, end] of edges) {
      const key = edgeKey(start, end);
      const edgeTriangles = edgeMap.get(key) ?? [];
      edgeTriangles.push(triangleIndex);
      edgeMap.set(key, edgeTriangles);
    }
  }

  geometry.computeBoundingBox();

  return {
    triangles,
    edgeMap,
    bounds: geometry.boundingBox?.clone() ?? new THREE.Box3(),
  };
}

function getFaceLabel(normal: THREE.Vector3) {
  if (normal.x > NORMAL_ALIGNMENT_EPSILON) return "Right (+X)";
  if (normal.x < -NORMAL_ALIGNMENT_EPSILON) return "Left (-X)";
  if (normal.y > NORMAL_ALIGNMENT_EPSILON) return "Back (+Y)";
  if (normal.y < -NORMAL_ALIGNMENT_EPSILON) return "Front (-Y)";
  if (normal.z > NORMAL_ALIGNMENT_EPSILON) return "Top (+Z)";
  if (normal.z < -NORMAL_ALIGNMENT_EPSILON) return "Bottom (-Z)";

  return `Flat region (${normal.x.toFixed(2)}, ${normal.y.toFixed(2)}, ${normal.z.toFixed(2)})`;
}

function getSelectionBoundaryEdges(
  selectionData: MeshSelectionData,
  triangleIndices: ReadonlyArray<number>,
) {
  const edgeCounts = new Map<string, { start: number; end: number; count: number }>();

  for (const triangleIndex of triangleIndices) {
    const triangle = selectionData.triangles[triangleIndex];

    if (!triangle) {
      continue;
    }

    const edges: Array<[number, number]> = [
      [triangle.indices[0], triangle.indices[1]],
      [triangle.indices[1], triangle.indices[2]],
      [triangle.indices[2], triangle.indices[0]],
    ];

    for (const [start, end] of edges) {
      const key = edgeKey(start, end);
      const current = edgeCounts.get(key);

      if (current) {
        current.count += 1;
      } else {
        edgeCounts.set(key, { start, end, count: 1 });
      }
    }
  }

  return Array.from(edgeCounts.values())
    .filter((edge) => edge.count === 1)
    .map<BoundaryEdge>(({ start, end }) => ({ start, end }));
}

export function createBoundarySegments(boundaryLoop: ReadonlyArray<PolylinePoint>) {
  const positions: number[] = [];

  for (let index = 1; index < boundaryLoop.length; index += 1) {
    const [startX, startY, startZ] = boundaryLoop[index - 1];
    const [endX, endY, endZ] = boundaryLoop[index];

    positions.push(startX, startY, startZ, endX, endY, endZ);
  }

  return positions;
}

function getLoopArea(loop: ReadonlyArray<PolylinePoint>) {
  let area = 0;

  for (let index = 0; index < loop.length - 1; index += 1) {
    const [ax, ay] = loop[index];
    const [bx, by] = loop[index + 1];
    area += ax * by - bx * ay;
  }

  return area / 2;
}

function createOuterBoundaryLoop(
  geometry: THREE.BufferGeometry,
  selectionData: MeshSelectionData,
  triangleIndices: ReadonlyArray<number>,
) {
  const positionAttribute = geometry.getAttribute("position");
  const boundaryEdges = getSelectionBoundaryEdges(selectionData, triangleIndices);

  if (boundaryEdges.length < 3) {
    return {
      boundaryLoop: null,
      planeZ: null,
      validationError: "Selected face must resolve to a closed boundary.",
    };
  }

  const adjacency = new Map<number, number[]>();
  const remainingEdges = new Map<string, BoundaryEdge>();

  for (const edge of boundaryEdges) {
    const startNeighbors = adjacency.get(edge.start) ?? [];
    startNeighbors.push(edge.end);
    adjacency.set(edge.start, startNeighbors);

    const endNeighbors = adjacency.get(edge.end) ?? [];
    endNeighbors.push(edge.start);
    adjacency.set(edge.end, endNeighbors);

    remainingEdges.set(edgeKey(edge.start, edge.end), edge);
  }

  for (const neighbors of adjacency.values()) {
    if (neighbors.length !== 2) {
      return {
        boundaryLoop: null,
        planeZ: null,
        validationError: "Selected face boundary is not a simple closed contour.",
      };
    }
  }

  const loops: PolylinePoint[][] = [];

  while (remainingEdges.size > 0) {
    const startEdge = remainingEdges.values().next().value;

    if (!startEdge) {
      break;
    }

    const orderedVertexIndices = [startEdge.start];
    let previousVertex: number | null = null;
    let currentVertex = startEdge.start;

    while (true) {
      const neighbors = adjacency.get(currentVertex) ?? [];
      const nextVertex = neighbors.find((neighbor) => neighbor !== previousVertex);

      if (nextVertex == null) {
        return {
          boundaryLoop: null,
          planeZ: null,
          validationError: "Selected face boundary could not be ordered into a closed loop.",
        };
      }

      const currentEdgeKey = edgeKey(currentVertex, nextVertex);

      if (!remainingEdges.has(currentEdgeKey)) {
        return {
          boundaryLoop: null,
          planeZ: null,
          validationError: "Selected face boundary contains overlapping or ambiguous loops.",
        };
      }

      remainingEdges.delete(currentEdgeKey);
      orderedVertexIndices.push(nextVertex);

      if (nextVertex === startEdge.start) {
        break;
      }

      previousVertex = currentVertex;
      currentVertex = nextVertex;

      if (orderedVertexIndices.length > boundaryEdges.length + 1) {
        return {
          boundaryLoop: null,
          planeZ: null,
          validationError: "Selected face boundary did not close cleanly.",
        };
      }
    }

    const loop = orderedVertexIndices.map((vertexIndex) => {
      const vertex = getVertex(positionAttribute, vertexIndex);
      return [vertex.x, vertex.y, vertex.z] as const;
    });

    if (loop.length < 4) {
      continue;
    }

    loops.push(loop);
  }

  if (loops.length === 0) {
    return {
      boundaryLoop: null,
      planeZ: null,
      validationError: "Selected face boundary is too small to profile.",
    };
  }

  const boundaryLoop = loops.reduce((largestLoop, loop) => {
    return Math.abs(getLoopArea(loop)) > Math.abs(getLoopArea(largestLoop))
      ? loop
      : largestLoop;
  });

  const planeZ = boundaryLoop[0][2];
  const isPlanarInZ = boundaryLoop.every(([, , z]) => Math.abs(z - planeZ) <= PLANE_EPSILON);

  if (!isPlanarInZ) {
    return {
      boundaryLoop: null,
      planeZ: null,
      validationError: "Selected face is not coplanar to XY.",
    };
  }

  return {
    boundaryLoop,
    planeZ,
    validationError: null,
  };
}

export function createMeshFaceSelection(
  geometry: THREE.BufferGeometry,
  selectionData: MeshSelectionData,
  startTriangleIndex: number,
): MeshFaceSelection {
  const targetNormal = selectionData.triangles[startTriangleIndex].normal;
  const triangleQueue = [startTriangleIndex];
  const visited = new Set<number>(triangleQueue);
  const selectedTriangles: number[] = [];

  while (triangleQueue.length > 0) {
    const triangleIndex = triangleQueue.shift();

    if (triangleIndex === undefined) {
      continue;
    }

    selectedTriangles.push(triangleIndex);

    const triangle = selectionData.triangles[triangleIndex];
    const edges: Array<[number, number]> = [
      [triangle.indices[0], triangle.indices[1]],
      [triangle.indices[1], triangle.indices[2]],
      [triangle.indices[2], triangle.indices[0]],
    ];

    for (const [start, end] of edges) {
      const neighbors = selectionData.edgeMap.get(edgeKey(start, end)) ?? [];

      for (const neighborTriangleIndex of neighbors) {
        if (visited.has(neighborTriangleIndex)) {
          continue;
        }

        const neighborTriangle = selectionData.triangles[neighborTriangleIndex];
        if (neighborTriangle.normal.dot(targetNormal) < NORMAL_ALIGNMENT_EPSILON) {
          continue;
        }

        visited.add(neighborTriangleIndex);
        triangleQueue.push(neighborTriangleIndex);
      }
    }
  }

  selectedTriangles.sort((left, right) => left - right);

  const area = selectedTriangles.reduce(
    (sum, triangleIndex) => sum + selectionData.triangles[triangleIndex].area,
    0,
  );

  const isParallelToXY = Math.abs(targetNormal.z) > NORMAL_ALIGNMENT_EPSILON;
  let boundaryLoop: ReadonlyArray<PolylinePoint> | null = null;
  let planeZ: number | null = null;
  let validationError: string | null = null;

  if (!isParallelToXY) {
    validationError = "Selected face is not parallel to XY.";
  } else {
    const boundary = createOuterBoundaryLoop(geometry, selectionData, selectedTriangles);
    boundaryLoop = boundary.boundaryLoop;
    planeZ = boundary.planeZ;
    validationError = boundary.validationError;
  }

  return {
    id: `mesh-face-${selectedTriangles.join("-")}`,
    label: getFaceLabel(targetNormal),
    normal: [targetNormal.x, targetNormal.y, targetNormal.z],
    triangleIndices: selectedTriangles,
    triangleCount: selectedTriangles.length,
    area,
    isParallelToXY,
    planeZ,
    boundaryLoop,
    validationError,
  };
}
