import { useCallback, useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { Line2 } from "three/examples/jsm/lines/Line2.js";
import { LineGeometry } from "three/examples/jsm/lines/LineGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import {
  mergeVertices,
  toCreasedNormals,
} from "three/examples/jsm/utils/BufferGeometryUtils.js";

import { SCSRenderer } from "@/simulation/scs/scs-renderer";
import {
  type SimulationSamplePoint,
  type ToolData,
  type ToolpathKind,
} from "@/simulation/toolpath";
import { cn } from "@/lib/utils";

export type PolylinePoint = readonly [number, number, number];

export type PolylineDefinition = {
  id: string;
  name: string;
  points: ReadonlyArray<PolylinePoint>;
  color?: string;
  kind?: ToolpathKind;
};

export type MeshFaceSelection = {
  id: string;
  label: string;
  normal: [number, number, number];
  triangleIndices: number[];
  triangleCount: number;
  area: number;
  isParallelToXY: boolean;
  planeZ: number | null;
  boundaryLoop: ReadonlyArray<PolylinePoint> | null;
  validationError: string | null;
};

type PolylineViewerProps = {
  meshUrl?: string | null;
  meshColor?: number;
  meshEdgeColor?: number;
  polylines: ReadonlyArray<PolylineDefinition>;
  className?: string;
  faceSelectionMode?: boolean;
  selectedMeshFace?: MeshFaceSelection | null;
  simulationTool?: ToolData | null;
  simulationSamples?: ReadonlyArray<SimulationSamplePoint>;
  simulationStep?: number;
  showOriginalMesh?: boolean;
  onMeshFaceSelect?: (selection: MeshFaceSelection) => void;
};

type TriangleData = {
  indices: [number, number, number];
  normal: THREE.Vector3;
  area: number;
};

type MeshSelectionData = {
  triangles: TriangleData[];
  edgeMap: Map<string, number[]>;
  bounds: THREE.Box3;
};

type BoundaryEdge = {
  start: number;
  end: number;
};

const POLYLINE_COLORS = ["#60a5fa", "#f97316", "#22c55e", "#e879f9"] as const;
const POLYLINE_LINEWIDTH = 2.35;
const POLYLINE_HALO_LINEWIDTH = 4.8;
const CLEARANCE_POLYLINE_LINEWIDTH = 2.1;
const CLEARANCE_POLYLINE_HALO_LINEWIDTH = 4.2;
const CLEARANCE_DASH_SIZE = 1.5;
const CLEARANCE_GAP_SIZE = 1.1;
const MESH_EDGE_LINEWIDTH = 1.35;
const MESH_DEPTH_OFFSET_FACTOR = 1;
const MESH_DEPTH_OFFSET_UNITS = 1;
const OVERLAY_LIFT_FACTOR = 1e-5;
const MIN_OVERLAY_LIFT = 0.0001;
const MAX_OVERLAY_LIFT = 0.05;
const CAMERA_NEAR_DISTANCE_FACTOR = 1e-4;
const CAMERA_NEAR_SCENE_FACTOR = 1e-5;
const CAMERA_FAR_RADIUS_MULTIPLIER = 6;
const CAMERA_MAX_DISTANCE_MULTIPLIER = 14;
const NORMAL_ALIGNMENT_EPSILON = 0.9999;
const DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES = 12;
const DISPLAY_SHADING_CREASE_ANGLE_DEGREES = 35;
const PLANE_EPSILON = 0.001;
const STOCK_COLOR = 0xcbd5e1;
const CUT_SURFACE_COLOR = 0xfb923c;
const TOOL_PREVIEW_COLOR = 0xf59e0b;
const DEFAULT_SCENE_BOUNDS = new THREE.Box3(
  new THREE.Vector3(-90, -90, 0),
  new THREE.Vector3(110, 90, 90),
);

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

function getPolylineBounds(polylines: ReadonlyArray<PolylineDefinition>) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  for (const polyline of polylines) {
    for (const [x, y, z] of polyline.points) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      minZ = Math.min(minZ, z);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      maxZ = Math.max(maxZ, z);
    }
  }

  if (!Number.isFinite(minX)) {
    return null;
  }

  return new THREE.Box3(
    new THREE.Vector3(minX, minY, minZ),
    new THREE.Vector3(maxX, maxY, maxZ),
  );
}

function getSceneBounds(
  polylines: ReadonlyArray<PolylineDefinition>,
  meshBounds?: THREE.Box3 | null,
) {
  const bounds = (meshBounds ?? DEFAULT_SCENE_BOUNDS).clone();
  const polylineBounds = getPolylineBounds(polylines);

  return polylineBounds ? bounds.union(polylineBounds) : bounds;
}

function getSceneDiagonal(box: THREE.Box3) {
  return box.getSize(new THREE.Vector3()).length();
}

function getOverlayLift(box: THREE.Box3) {
  return THREE.MathUtils.clamp(
    getSceneDiagonal(box) * OVERLAY_LIFT_FACTOR,
    MIN_OVERLAY_LIFT,
    MAX_OVERLAY_LIFT,
  );
}

function updateCameraDepthRange(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const size = box.getSize(new THREE.Vector3());
  const sceneRadius = Math.max(size.length() * 0.5, 0.5);
  const distanceToTarget = Math.max(
    camera.position.distanceTo(controls.target),
    sceneRadius * 0.1,
    0.01,
  );
  const near = Math.max(
    0.001,
    distanceToTarget * CAMERA_NEAR_DISTANCE_FACTOR,
    sceneRadius * CAMERA_NEAR_SCENE_FACTOR,
  );
  const far = Math.max(
    near * 10,
    distanceToTarget + sceneRadius * CAMERA_FAR_RADIUS_MULTIPLIER,
  );

  if (Math.abs(camera.near - near) > 1e-6 || Math.abs(camera.far - far) > 1e-3) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
}

function fitCameraToBox(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDimension = Math.max(size.x, size.y, size.z, 1);
  const fovRadians = (camera.fov * Math.PI) / 180;
  const distance = maxDimension / (2 * Math.tan(fovRadians / 2));

  camera.position.set(
    center.x + distance * 1.35,
    center.y - distance * 1.1,
    center.z + distance * 0.9,
  );

  controls.target.copy(center);
  controls.minDistance = Math.max(maxDimension * 0.0005, 0.01);
  controls.maxDistance = Math.max(maxDimension * CAMERA_MAX_DISTANCE_MULTIPLIER, distance * 2);
  controls.update();

  updateCameraDepthRange(box, camera, controls);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (
      child instanceof THREE.Line ||
      child instanceof THREE.Mesh ||
      child instanceof THREE.Points
    ) {
      child.geometry.dispose();

      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];

      for (const material of materials) {
        material.dispose();
      }
    }
  });
}

function clearGroup(group: THREE.Group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    disposeObject(child);
  }
}

function createSimulationStockMesh(bounds: THREE.Box3) {
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

function createBaseSimulationCylinderGeometry() {
  const geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 24, 1, false);
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

function createMeshSelectionData(geometry: THREE.BufferGeometry): MeshSelectionData {
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

function createBoundarySegments(boundaryLoop: ReadonlyArray<PolylinePoint>) {
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

function createMeshFaceSelection(
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

export function PolylineViewer({
  meshUrl = null,
  meshColor = 0x94a3b8,
  meshEdgeColor = 0x334155,
  polylines,
  className,
  faceSelectionMode = false,
  selectedMeshFace = null,
  simulationTool = null,
  simulationSamples = [],
  simulationStep = 0,
  showOriginalMesh = true,
  onMeshFaceSelect,
}: PolylineViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const currentPolylinesRef = useRef(polylines);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const polylineGroupRef = useRef<THREE.Group | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const meshSelectionMeshRef = useRef<THREE.Mesh | null>(null);
  const meshSelectionDataRef = useRef<MeshSelectionData | null>(null);
  const meshBoundsRef = useRef<THREE.Box3 | null>(null);
  const selectionHighlightGroupRef = useRef<THREE.Group | null>(null);
  const selectionOutlineMaterialRef = useRef<LineMaterial | null>(null);
  const meshEdgeMaterialRef = useRef<LineMaterial | null>(null);
  const polylineMaterialsRef = useRef<LineMaterial[]>([]);
  const scsRendererRef = useRef<SCSRenderer | null>(null);
  const simulationDummyMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationToolPreviewMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationStockMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationCutterGeometryRef = useRef<THREE.CylinderGeometry | null>(null);
  const simulationCutterMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const simulationCuttersRef = useRef<THREE.Mesh[]>([]);
  const simulationPreparedStepRef = useRef(0);
  const faceSelectionModeRef = useRef(faceSelectionMode);
  const onMeshFaceSelectRef = useRef(onMeshFaceSelect);
  const selectedMeshFaceRef = useRef(selectedMeshFace);
  const simulationToolRef = useRef<ToolData | null>(simulationTool);
  const simulationSamplesRef = useRef<ReadonlyArray<SimulationSamplePoint>>(simulationSamples);
  const simulationStepRef = useRef(simulationStep);
  const hasUserInteractedRef = useRef(false);

  useEffect(() => {
    currentPolylinesRef.current = polylines;
  }, [polylines]);

  useEffect(() => {
    faceSelectionModeRef.current = faceSelectionMode;

    const renderer = rendererRef.current;
    if (renderer) {
      renderer.domElement.style.cursor = faceSelectionMode ? "crosshair" : "default";
    }
  }, [faceSelectionMode]);

  useEffect(() => {
    onMeshFaceSelectRef.current = onMeshFaceSelect;
  }, [onMeshFaceSelect]);

  useEffect(() => {
    selectedMeshFaceRef.current = selectedMeshFace;
  }, [selectedMeshFace]);

  const clearSimulationResources = useCallback(() => {
    if (simulationStockMeshRef.current) {
      simulationStockMeshRef.current.geometry.dispose();
      const stockMaterial = Array.isArray(simulationStockMeshRef.current.material)
        ? simulationStockMeshRef.current.material
        : [simulationStockMeshRef.current.material];
      stockMaterial.forEach((material) => material.dispose());
      simulationStockMeshRef.current = null;
    }

    if (simulationToolPreviewMeshRef.current) {
      simulationToolPreviewMeshRef.current.visible = false;
    }

    simulationCuttersRef.current = [];
    simulationPreparedStepRef.current = 0;
  }, []);

  const updateToolPreview = useCallback(() => {
    const previewMesh = simulationToolPreviewMeshRef.current;
    const tool = simulationToolRef.current;
    const samples = simulationSamplesRef.current;
    const step = simulationStepRef.current;

    if (!previewMesh || !tool || step <= 0 || samples.length === 0) {
      if (previewMesh) {
        previewMesh.visible = false;
      }
      return;
    }

    const sample = samples[Math.min(step, samples.length) - 1];
    previewMesh.scale.set(tool.diameter, tool.diameter, tool.cuttingHeight);
    previewMesh.position.set(sample.x, sample.y, sample.z + tool.cuttingHeight / 2);
    previewMesh.visible = true;
    previewMesh.updateMatrixWorld(true);
  }, []);

  const prepareSimulationCutters = useCallback((targetStep: number) => {
    const tool = simulationToolRef.current;
    const samples = simulationSamplesRef.current;
    const baseGeometry = simulationCutterGeometryRef.current;
    const cutterMaterial = simulationCutterMaterialRef.current;

    if (!tool || !baseGeometry || !cutterMaterial) {
      return;
    }

    const clampedTargetStep = Math.max(0, Math.min(targetStep, samples.length));
    for (
      let index = simulationPreparedStepRef.current;
      index < clampedTargetStep;
      index += 1
    ) {
      const sample = samples[index];
      const cutter = new THREE.Mesh(baseGeometry, cutterMaterial);
      cutter.scale.set(tool.diameter, tool.diameter, tool.cuttingHeight);
      cutter.position.set(sample.x, sample.y, sample.z + tool.cuttingHeight / 2);
      cutter.updateMatrixWorld(true);
      simulationCuttersRef.current.push(cutter);
    }

    simulationPreparedStepRef.current = Math.max(
      simulationPreparedStepRef.current,
      clampedTargetStep,
    );
  }, []);

  const rebuildSimulationResources = useCallback(() => {
    clearSimulationResources();

    const tool = simulationToolRef.current;
    const samples = simulationSamplesRef.current;
    const bounds = meshBoundsRef.current;

    if (!tool || samples.length === 0 || !bounds) {
      updateToolPreview();
      return;
    }

    if (!simulationCutterGeometryRef.current) {
      simulationCutterGeometryRef.current = createBaseSimulationCylinderGeometry();
    }

    if (!simulationCutterMaterialRef.current) {
      simulationCutterMaterialRef.current = new THREE.MeshBasicMaterial({
        color: CUT_SURFACE_COLOR,
      });
    }

    simulationStockMeshRef.current = createSimulationStockMesh(bounds);
    prepareSimulationCutters(simulationStepRef.current);
    updateToolPreview();
  }, [clearSimulationResources, prepareSimulationCutters, updateToolPreview]);

  useEffect(() => {
    simulationToolRef.current = simulationTool;
    simulationSamplesRef.current = simulationSamples;
    rebuildSimulationResources();
  }, [rebuildSimulationResources, simulationSamples, simulationTool]);

  useEffect(() => {
    simulationStepRef.current = simulationStep;
    prepareSimulationCutters(simulationStep);
    updateToolPreview();
  }, [prepareSimulationCutters, simulationStep, updateToolPreview]);

  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) {
      return;
    }

    meshGroup.visible = faceSelectionMode || showOriginalMesh || !simulationTool;
  }, [faceSelectionMode, showOriginalMesh, simulationTool]);

  const renderSelectionHighlight = useCallback((selection: MeshFaceSelection | null) => {
    const mesh = meshRef.current;
    const selectionHighlightGroup = selectionHighlightGroupRef.current;
    const renderer = rendererRef.current;
    const selectionData = meshSelectionDataRef.current;

    if (
      !mesh ||
      !selectionHighlightGroup ||
      !(mesh.geometry instanceof THREE.BufferGeometry) ||
      !renderer ||
      !selectionData
    ) {
      return;
    }

    clearGroup(selectionHighlightGroup);
    selectionOutlineMaterialRef.current = null;

    if (
      !selection ||
      selection.triangleIndices.some(
        (triangleIndex) =>
          triangleIndex < 0 || triangleIndex >= selectionData.triangles.length,
      )
    ) {
      return;
    }

    if (!selection.boundaryLoop) {
      return;
    }

    const boundaryPositions = createBoundarySegments(selection.boundaryLoop);

    if (boundaryPositions.length > 0) {
      const outlineGeometry = new LineSegmentsGeometry();
      outlineGeometry.setPositions(boundaryPositions);

      const outlineMaterial = new LineMaterial({
        color: 0xf59e0b,
        linewidth: POLYLINE_LINEWIDTH,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      outlineMaterial.alphaToCoverage = true;
      outlineMaterial.resolution.set(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight,
      );

      const outline = new LineSegments2(outlineGeometry, outlineMaterial);
      outline.renderOrder = 10;
      selectionHighlightGroup.add(outline);
      selectionOutlineMaterialRef.current = outlineMaterial;
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;

    if (!container) {
      return undefined;
    }

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      stencil: true,
      reversedDepthBuffer: true,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.autoClear = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    renderer.domElement.style.cursor = faceSelectionModeRef.current ? "crosshair" : "default";
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.screenSpacePanning = true;
    controls.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.DOLLY,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    controls.addEventListener("start", () => {
      hasUserInteractedRef.current = true;
    });
    controlsRef.current = controls;

    const initialBounds = getSceneBounds(currentPolylinesRef.current);
    fitCameraToBox(initialBounds, camera, controls);

    const size = initialBounds.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z, 1);
    const gridSize = Math.max(120, Math.ceil(maxDimension * 1.8));
    const gridDivisions = Math.max(10, Math.round(gridSize / 12));

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
    directionalLight.position.set(90, -70, 120);
    scene.add(directionalLight);

    const grid = new THREE.GridHelper(gridSize, gridDivisions, 0x6b7280, 0x3f3f46);
    grid.rotation.x = Math.PI / 2;
    const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
    for (const material of gridMaterials) {
      material.transparent = true;
      material.opacity = 0.45;
    }
    scene.add(grid);

    const axesHelper = new THREE.AxesHelper(Math.max(maxDimension * 0.22, 18));
    scene.add(axesHelper);

    const polylineGroup = new THREE.Group();
    scene.add(polylineGroup);
    polylineGroupRef.current = polylineGroup;

    const meshGroup = new THREE.Group();
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const simulationToolPreviewGeometry = createBaseSimulationCylinderGeometry();
    const simulationToolPreviewMesh = new THREE.Mesh(
      simulationToolPreviewGeometry,
      new THREE.MeshStandardMaterial({
        color: TOOL_PREVIEW_COLOR,
        transparent: true,
        opacity: 0.35,
        roughness: 0.45,
        metalness: 0.05,
      }),
    );
    simulationToolPreviewMesh.visible = false;
    scene.add(simulationToolPreviewMesh);
    simulationToolPreviewMeshRef.current = simulationToolPreviewMesh;

    const simulationDummyMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    );
    simulationDummyMesh.position.set(1_000_000, 1_000_000, 1_000_000);
    simulationDummyMesh.visible = false;
    scene.add(simulationDummyMesh);
    simulationDummyMeshRef.current = simulationDummyMesh;

    scsRendererRef.current = new SCSRenderer(renderer);

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const handlePointerDown = (event: PointerEvent) => {
      if (!faceSelectionModeRef.current || event.button !== 0) {
        return;
      }

      const currentCamera = cameraRef.current;
      const currentSelectionMesh = meshSelectionMeshRef.current;
      const selectionData = meshSelectionDataRef.current;

      if (!currentCamera || !currentSelectionMesh || !selectionData) {
        return;
      }

      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

      raycaster.setFromCamera(pointer, currentCamera);
      const [intersection] = raycaster.intersectObject(currentSelectionMesh, false);

      if (!intersection || intersection.faceIndex == null) {
        return;
      }

      const selection = createMeshFaceSelection(
        currentSelectionMesh.geometry as THREE.BufferGeometry,
        selectionData,
        intersection.faceIndex,
      );
      onMeshFaceSelectRef.current?.(selection);
      event.preventDefault();
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);

    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;

      if (width === 0 || height === 0) {
        return;
      }

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      selectionOutlineMaterialRef.current?.resolution.set(width, height);
      meshEdgeMaterialRef.current?.resolution.set(width, height);
      for (const material of polylineMaterialsRef.current) {
        material.resolution.set(width, height);
      }
    };

    resize();

    const resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(container);

    let animationFrame = 0;

    const render = () => {
      controls.update();
      updateCameraDepthRange(
        getSceneBounds(currentPolylinesRef.current, meshBoundsRef.current),
        camera,
        controls,
      );
      renderer.clear();
      renderer.render(scene, camera);

      const scsRenderer = scsRendererRef.current;
      const simulationStock = simulationStockMeshRef.current;
      const simulationDummyMesh = simulationDummyMeshRef.current;

      if (scsRenderer && simulationStock && simulationDummyMesh) {
        const activeCutters = simulationCuttersRef.current.slice(
          0,
          Math.min(simulationStepRef.current, simulationCuttersRef.current.length),
        );

        renderer.clearDepth();
        scsRenderer.renderSubtract(
          scene,
          camera,
          simulationStock,
          activeCutters,
          simulationDummyMesh,
        );
      }

      animationFrame = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      controls.dispose();
      clearSimulationResources();
      simulationCutterGeometryRef.current?.dispose();
      simulationCutterMaterialRef.current?.dispose();
      scsRendererRef.current?.dispose();
      disposeObject(scene);
      renderer.dispose();

      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }

      rendererRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      polylineGroupRef.current = null;
      meshGroupRef.current = null;
      meshRef.current = null;
      meshSelectionMeshRef.current = null;
      meshSelectionDataRef.current = null;
      meshBoundsRef.current = null;
      selectionHighlightGroupRef.current = null;
      selectionOutlineMaterialRef.current = null;
      meshEdgeMaterialRef.current = null;
      polylineMaterialsRef.current = [];
      scsRendererRef.current = null;
      simulationDummyMeshRef.current = null;
      simulationToolPreviewMeshRef.current = null;
      simulationStockMeshRef.current = null;
      simulationCutterGeometryRef.current = null;
      simulationCutterMaterialRef.current = null;
      simulationCuttersRef.current = [];
      simulationPreparedStepRef.current = 0;
    };
  }, [clearSimulationResources, renderSelectionHighlight]);

  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;

    if (!meshGroup || !camera || !controls || !renderer) {
      return undefined;
    }

    clearGroup(meshGroup);
    clearSimulationResources();
    meshRef.current = null;
    meshSelectionMeshRef.current = null;
    meshSelectionDataRef.current = null;
    meshBoundsRef.current = null;
    selectionHighlightGroupRef.current = null;
    selectionOutlineMaterialRef.current = null;
    meshEdgeMaterialRef.current = null;

    let cancelled = false;

    if (!meshUrl) {
      if (!hasUserInteractedRef.current) {
        fitCameraToBox(getSceneBounds(currentPolylinesRef.current), camera, controls);
      }

      return undefined;
    }

    const loadMesh = async () => {
      try {
        const response = await fetch(meshUrl);

        if (!response.ok) {
          throw new Error(`Failed to load mesh (${response.status}).`);
        }

        const buffer = await response.arrayBuffer();

        if (cancelled) {
          return;
        }

        const loader = new STLLoader();
        const meshGeometry = loader.parse(buffer);
        meshGeometry.deleteAttribute("normal");
        const weldedGeometry = mergeVertices(meshGeometry);
        meshGeometry.dispose();
        weldedGeometry.computeBoundingBox();
        weldedGeometry.computeBoundingSphere();

        const renderGeometry = toCreasedNormals(
          weldedGeometry.clone(),
          THREE.MathUtils.degToRad(DISPLAY_SHADING_CREASE_ANGLE_DEGREES),
        );
        renderGeometry.computeBoundingBox();
        renderGeometry.computeBoundingSphere();

        const depthMaterial = new THREE.MeshDepthMaterial({
          depthWrite: true,
          depthTest: true,
          polygonOffset: true,
          polygonOffsetFactor: MESH_DEPTH_OFFSET_FACTOR,
          polygonOffsetUnits: MESH_DEPTH_OFFSET_UNITS,
        });
        depthMaterial.colorWrite = false;

        const depthMesh = new THREE.Mesh(renderGeometry, depthMaterial);
        depthMesh.renderOrder = 0;
        depthMesh.frustumCulled = false;
        meshGroup.add(depthMesh);

        const meshMaterial = new THREE.MeshStandardMaterial({
          color: meshColor,
          roughness: 0.72,
          metalness: 0.02,
          depthWrite: false,
          depthFunc: THREE.LessEqualDepth,
        });
        const mesh = new THREE.Mesh(renderGeometry, meshMaterial);
        mesh.renderOrder = 1;
        mesh.frustumCulled = false;
        meshGroup.add(mesh);
        meshGroup.visible =
          faceSelectionModeRef.current || showOriginalMesh || !simulationToolRef.current;
        meshRef.current = mesh;

        const selectionMeshMaterial = new THREE.MeshBasicMaterial({
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0,
          depthTest: false,
          depthWrite: false,
        });
        selectionMeshMaterial.colorWrite = false;
        const selectionMesh = new THREE.Mesh(weldedGeometry, selectionMeshMaterial);
        meshGroup.add(selectionMesh);
        meshSelectionMeshRef.current = selectionMesh;

        const edgeSource = new THREE.EdgesGeometry(
          weldedGeometry,
          DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES,
        );
        const edgeGeometry = new LineSegmentsGeometry().fromEdgesGeometry(edgeSource);
        edgeSource.dispose();

        const edgeMaterial = new LineMaterial({
          color: meshEdgeColor,
          linewidth: MESH_EDGE_LINEWIDTH,
          alphaToCoverage: true,
          depthTest: true,
          depthWrite: false,
          transparent: false,
        });
        edgeMaterial.resolution.set(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight,
        );
        meshEdgeMaterialRef.current = edgeMaterial;

        const edgeLines = new LineSegments2(edgeGeometry, edgeMaterial);
        edgeLines.renderOrder = 2;
        edgeLines.frustumCulled = false;
        meshGroup.add(edgeLines);

        const selectionHighlightGroup = new THREE.Group();
        mesh.add(selectionHighlightGroup);
        selectionHighlightGroupRef.current = selectionHighlightGroup;

        const selectionData = createMeshSelectionData(weldedGeometry);
        meshSelectionDataRef.current = selectionData;
        meshBoundsRef.current = selectionData.bounds.clone();

        if (!hasUserInteractedRef.current) {
          const bounds = getSceneBounds(currentPolylinesRef.current, selectionData.bounds);
          fitCameraToBox(bounds, camera, controls);
        }

        renderSelectionHighlight(selectedMeshFaceRef.current);
        rebuildSimulationResources();
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load STL mesh", error);
        }
      }
    };

    void loadMesh();

    return () => {
      cancelled = true;
      clearGroup(meshGroup);
      clearSimulationResources();
      meshRef.current = null;
      meshSelectionMeshRef.current = null;
      meshSelectionDataRef.current = null;
      meshBoundsRef.current = null;
      selectionHighlightGroupRef.current = null;
      selectionOutlineMaterialRef.current = null;
      meshEdgeMaterialRef.current = null;
    };
  }, [clearSimulationResources, meshColor, meshEdgeColor, meshUrl, rebuildSimulationResources, renderSelectionHighlight, showOriginalMesh]);

  useEffect(() => {
    const polylineGroup = polylineGroupRef.current;
    const renderer = rendererRef.current;

    if (!polylineGroup || !renderer) {
      return;
    }

    clearGroup(polylineGroup);
    polylineMaterialsRef.current = [];

    const bounds = getSceneBounds(polylines, meshBoundsRef.current);
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    if (!hasUserInteractedRef.current && camera && controls) {
      fitCameraToBox(bounds, camera, controls);
    }

    const overlayLift = getOverlayLift(bounds);

    polylines.forEach((polyline, index) => {
      const color = polyline.color ?? POLYLINE_COLORS[index % POLYLINE_COLORS.length];
      const isClearanceMove = polyline.kind === "clearance";

      if (polyline.points.length < 2) {
        return;
      }

      const positions = polyline.points.flatMap(([x, y, z]) => [x, y, z + overlayLift]);
      const haloGeometry = new LineGeometry();
      haloGeometry.setPositions(positions);
      const lineGeometry = new LineGeometry();
      lineGeometry.setPositions(positions);

      const haloMaterial = new LineMaterial({
        color: 0x0f172a,
        linewidth: isClearanceMove
          ? CLEARANCE_POLYLINE_HALO_LINEWIDTH
          : POLYLINE_HALO_LINEWIDTH,
        transparent: true,
        opacity: isClearanceMove ? 0.5 : 0.42,
        depthTest: true,
        depthWrite: false,
      });
      haloMaterial.alphaToCoverage = true;
      haloMaterial.resolution.set(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight,
      );
      if (isClearanceMove) {
        haloMaterial.dashed = true;
        haloMaterial.dashScale = 1;
        haloMaterial.dashSize = CLEARANCE_DASH_SIZE;
        haloMaterial.gapSize = CLEARANCE_GAP_SIZE;
      }

      const haloLine = new Line2(haloGeometry, haloMaterial);
      if (isClearanceMove) {
        haloLine.computeLineDistances();
      }
      haloLine.renderOrder = 18;
      polylineGroup.add(haloLine);
      polylineMaterialsRef.current.push(haloMaterial);

      const lineMaterial = new LineMaterial({
        color,
        linewidth: isClearanceMove ? CLEARANCE_POLYLINE_LINEWIDTH : POLYLINE_LINEWIDTH,
        transparent: true,
        opacity: 1,
        depthTest: true,
        depthWrite: false,
      });
      lineMaterial.alphaToCoverage = true;
      lineMaterial.resolution.set(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight,
      );
      if (isClearanceMove) {
        lineMaterial.dashed = true;
        lineMaterial.dashScale = 1;
        lineMaterial.dashSize = CLEARANCE_DASH_SIZE;
        lineMaterial.gapSize = CLEARANCE_GAP_SIZE;
      }

      const line = new Line2(lineGeometry, lineMaterial);
      if (isClearanceMove) {
        line.computeLineDistances();
      }
      line.renderOrder = 19;
      polylineGroup.add(line);
      polylineMaterialsRef.current.push(lineMaterial);
    });
  }, [polylines]);

  useEffect(() => {
    renderSelectionHighlight(selectedMeshFace);
  }, [renderSelectionHighlight, selectedMeshFace]);

  return (
    <div
      className={cn(
        "relative h-full min-h-0 overflow-hidden rounded-2xl border bg-gradient-to-br from-muted/30 via-background to-muted/50 shadow-sm",
        className,
      )}
    >
      <div ref={containerRef} className="h-full w-full" />

      {!meshUrl ? (
        <div className="pointer-events-none absolute bottom-4 left-4 rounded-xl border bg-background/85 p-3 shadow-sm backdrop-blur">
          <p className="text-xs text-muted-foreground">Upload an STL to begin.</p>
        </div>
      ) : null}
    </div>
  );
}
