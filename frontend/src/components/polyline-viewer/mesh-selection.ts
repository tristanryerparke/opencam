import { NORMAL_ALIGNMENT_EPSILON, PLANE_EPSILON } from "./constants";
import type { MeshFaceSelection, PolylinePoint } from "./types";

type Vector = readonly [number, number, number];

type TriangleData = {
  indices: [number, number, number];
  normal: Vector;
  area: number;
};

export type MeshSelectionData = {
  positions: Float32Array;
  triangles: TriangleData[];
  edgeMap: Map<string, number[]>;
};

type BoundaryEdge = {
  start: number;
  end: number;
};

function edgeKey(a: number, b: number) {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

function getVertex(positions: Float32Array, index: number): Vector {
  const offset = index * 3;
  return [positions[offset], positions[offset + 1], positions[offset + 2]];
}

function triangleNormal(a: Vector, b: Vector, c: Vector): { normal: Vector; area: number } {
  const ab: Vector = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vector = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const cross: Vector = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ];
  const length = Math.hypot(...cross);
  return {
    normal: length > 0 ? [cross[0] / length, cross[1] / length, cross[2] / length] : [0, 0, 0],
    area: length / 2,
  };
}

export function createMeshSelectionData(
  positionData: ArrayLike<number>,
  indexData: ArrayLike<number>,
): MeshSelectionData {
  if (positionData.length % 3 !== 0 || indexData.length % 3 !== 0) {
    throw new Error("Selection geometry must contain triangles.");
  }

  const positions = new Float32Array(positionData);
  const triangles: TriangleData[] = [];
  const edgeMap = new Map<string, number[]>();

  for (let triangleIndex = 0; triangleIndex < indexData.length / 3; triangleIndex += 1) {
    const indices: [number, number, number] = [
      indexData[triangleIndex * 3],
      indexData[triangleIndex * 3 + 1],
      indexData[triangleIndex * 3 + 2],
    ];
    const [a, b, c] = indices;
    const { normal, area } = triangleNormal(
      getVertex(positions, a),
      getVertex(positions, b),
      getVertex(positions, c),
    );
    triangles.push({ indices, normal, area });

    for (const [start, end] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(start, end);
      const edgeTriangles = edgeMap.get(key) ?? [];
      edgeTriangles.push(triangleIndex);
      edgeMap.set(key, edgeTriangles);
    }
  }

  return { positions, triangles, edgeMap };
}

function getFaceLabel(normal: Vector) {
  if (normal[0] > NORMAL_ALIGNMENT_EPSILON) return "Right (+X)";
  if (normal[0] < -NORMAL_ALIGNMENT_EPSILON) return "Left (-X)";
  if (normal[1] > NORMAL_ALIGNMENT_EPSILON) return "Back (+Y)";
  if (normal[1] < -NORMAL_ALIGNMENT_EPSILON) return "Front (-Y)";
  if (normal[2] > NORMAL_ALIGNMENT_EPSILON) return "Top (+Z)";
  if (normal[2] < -NORMAL_ALIGNMENT_EPSILON) return "Bottom (-Z)";

  return `Flat region (${normal.map((value) => value.toFixed(2)).join(", ")})`;
}

function dot(left: Vector, right: Vector) {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

function getSelectionBoundaryEdges(
  selectionData: MeshSelectionData,
  triangleIndices: ReadonlyArray<number>,
) {
  const edgeCounts = new Map<string, { start: number; end: number; count: number }>();

  for (const triangleIndex of triangleIndices) {
    const triangle = selectionData.triangles[triangleIndex];
    if (!triangle) continue;

    const [a, b, c] = triangle.indices;
    for (const [start, end] of [[a, b], [b, c], [c, a]] as const) {
      const key = edgeKey(start, end);
      const current = edgeCounts.get(key);
      if (current) current.count += 1;
      else edgeCounts.set(key, { start, end, count: 1 });
    }
  }

  return Array.from(edgeCounts.values())
    .filter((edge) => edge.count === 1)
    .map<BoundaryEdge>(({ start, end }) => ({ start, end }));
}

function getLoopArea(loop: ReadonlyArray<PolylinePoint>) {
  let area = 0;
  for (let index = 1; index < loop.length; index += 1) {
    const [ax, ay] = loop[index - 1];
    const [bx, by] = loop[index];
    area += ax * by - bx * ay;
  }
  return area / 2;
}

function createOuterBoundaryLoop(
  selectionData: MeshSelectionData,
  triangleIndices: ReadonlyArray<number>,
) {
  const boundaryEdges = getSelectionBoundaryEdges(selectionData, triangleIndices);
  if (boundaryEdges.length < 3) {
    return { boundaryLoop: null, planeZ: null, validationError: "Selected face must resolve to a closed boundary." };
  }

  const adjacency = new Map<number, number[]>();
  const remainingEdges = new Map<string, BoundaryEdge>();
  for (const edge of boundaryEdges) {
    adjacency.set(edge.start, [...(adjacency.get(edge.start) ?? []), edge.end]);
    adjacency.set(edge.end, [...(adjacency.get(edge.end) ?? []), edge.start]);
    remainingEdges.set(edgeKey(edge.start, edge.end), edge);
  }

  if (Array.from(adjacency.values()).some((neighbors) => neighbors.length !== 2)) {
    return { boundaryLoop: null, planeZ: null, validationError: "Selected face boundary is not a simple closed contour." };
  }

  const loops: PolylinePoint[][] = [];
  while (remainingEdges.size > 0) {
    const startEdge = remainingEdges.values().next().value as BoundaryEdge | undefined;
    if (!startEdge) break;

    const ordered = [startEdge.start];
    let previous: number | null = null;
    let current = startEdge.start;
    while (true) {
      const next = (adjacency.get(current) ?? []).find((vertex) => vertex !== previous);
      if (next == null || !remainingEdges.delete(edgeKey(current, next))) {
        return { boundaryLoop: null, planeZ: null, validationError: "Selected face boundary contains overlapping or ambiguous loops." };
      }
      ordered.push(next);
      if (next === startEdge.start) break;
      previous = current;
      current = next;
      if (ordered.length > boundaryEdges.length + 1) {
        return { boundaryLoop: null, planeZ: null, validationError: "Selected face boundary did not close cleanly." };
      }
    }

    if (ordered.length >= 4) {
      loops.push(ordered.map((index) => getVertex(selectionData.positions, index)));
    }
  }

  if (loops.length === 0) {
    return { boundaryLoop: null, planeZ: null, validationError: "Selected face boundary is too small to profile." };
  }

  const boundaryLoop = loops.reduce((largest, loop) => (
    Math.abs(getLoopArea(loop)) > Math.abs(getLoopArea(largest)) ? loop : largest
  ));
  const planeZ = boundaryLoop[0][2];
  if (!boundaryLoop.every(([, , z]) => Math.abs(z - planeZ) <= PLANE_EPSILON)) {
    return { boundaryLoop: null, planeZ: null, validationError: "Selected face is not coplanar to XY." };
  }

  return { boundaryLoop, planeZ, validationError: null };
}

export function createBoundarySegments(boundaryLoop: ReadonlyArray<PolylinePoint>) {
  return boundaryLoop.slice(1).flatMap((end, index) => [boundaryLoop[index], end]);
}

export function createMeshFaceSelection(
  selectionData: MeshSelectionData,
  startTriangleIndex: number,
): MeshFaceSelection {
  const startTriangle = selectionData.triangles[startTriangleIndex];
  if (!startTriangle) throw new Error("Selected triangle does not exist.");

  const targetNormal = startTriangle.normal;
  const queue = [startTriangleIndex];
  const visited = new Set(queue);
  const selectedTriangles: number[] = [];

  while (queue.length > 0) {
    const triangleIndex = queue.shift();
    if (triangleIndex == null) continue;
    selectedTriangles.push(triangleIndex);

    const [a, b, c] = selectionData.triangles[triangleIndex].indices;
    for (const [start, end] of [[a, b], [b, c], [c, a]] as const) {
      for (const neighborIndex of selectionData.edgeMap.get(edgeKey(start, end)) ?? []) {
        if (visited.has(neighborIndex)) continue;
        const neighbor = selectionData.triangles[neighborIndex];
        if (dot(neighbor.normal, targetNormal) < NORMAL_ALIGNMENT_EPSILON) continue;
        visited.add(neighborIndex);
        queue.push(neighborIndex);
      }
    }
  }

  selectedTriangles.sort((left, right) => left - right);
  const area = selectedTriangles.reduce((sum, index) => sum + selectionData.triangles[index].area, 0);
  const isParallelToXY = Math.abs(targetNormal[2]) > NORMAL_ALIGNMENT_EPSILON;
  const boundary = isParallelToXY
    ? createOuterBoundaryLoop(selectionData, selectedTriangles)
    : { boundaryLoop: null, planeZ: null, validationError: "Selected face is not parallel to XY." };

  return {
    id: `mesh-face-${selectedTriangles.join("-")}`,
    label: getFaceLabel(targetNormal),
    normal: [...targetNormal],
    triangleIndices: selectedTriangles,
    triangleCount: selectedTriangles.length,
    area,
    isParallelToXY,
    planeZ: boundary.planeZ,
    boundaryLoop: boundary.boundaryLoop,
    validationError: boundary.validationError,
  };
}
