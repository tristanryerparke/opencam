import { useCallback, useEffect, useRef, type RefObject } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
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
  CLEARANCE_POLYLINE_LINEWIDTH,
  CUT_SURFACE_COLOR,
  DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES,
  DISPLAY_SHADING_CREASE_ANGLE_DEGREES,
  MESH_EDGE_LINEWIDTH,
  POLYLINE_COLORS,
  POLYLINE_LINEWIDTH,
  TOOL_PREVIEW_COLOR,
} from "./constants";
import { loadMeshGeometry } from "./mesh-loader";
import { pickNearestStepEdgeLoop } from "./edge-loop-picking";
import {
  createBoundarySegments,
  createMeshFaceSelection,
  createMeshSelectionData,
  type MeshSelectionData,
} from "./mesh-selection";
import {
  buildStepEdgeLines,
  getStepEdgeLoops,
  stepEdgeLoopToSelection,
  type StepEdgeLoop,
  type StepFaceRange,
} from "./step-geometry";
import {
  clearGroup,
  disposeObject,
  fitCameraToBox,
  getOverlayLift,
  getSceneBounds,
  sceneBoundsEquals,
  updateCameraDepthRange,
} from "./scene-utils";
import { createSimulationStockMesh } from "./simulation";
import type { MeshFaceSelection, PolylineDefinition, PolylinePoint, PolylineViewerSceneProps, ToolRenderMode } from "./types";

type LoadedDisplayMesh = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  bounds: THREE.Box3 | null;
  edgeMaterial: LineMaterial | null;
  selectionMesh: THREE.Mesh | null;
  selectionData: MeshSelectionData | null;
  selectionHighlightGroup: THREE.Group | null;
  stepEdgeLoops: StepEdgeLoop[];
};

function readColorComponent(colors: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, index: number, channel: number) {
  const value = colors.getComponent(index, channel);
  return value > 1.5 ? value / 255 : value;
}

function hasNonWhiteVertexColors(geometry: THREE.BufferGeometry) {
  const colors = geometry.getAttribute("color");
  if (!colors) {
    return false;
  }

  for (let index = 0; index < colors.count; index += 1) {
    for (let channel = 0; channel < Math.min(colors.itemSize, 3); channel += 1) {
      if (readColorComponent(colors, index, channel) < 0.98) {
        return true;
      }
    }
  }

  return false;
}

function applyStockVertexColor(geometry: THREE.BufferGeometry, stockColor: number) {
  const colors = geometry.getAttribute("color");
  if (!colors) {
    return;
  }

  const stock = new THREE.Color(stockColor);
  const cut = new THREE.Color(0x9ca3af);
  const stockSource = new THREE.Color(0xfb923c);
  const nextColors = new Float32Array(colors.count * 3);

  for (let index = 0; index < colors.count; index += 1) {
    const r = readColorComponent(colors, index, 0);
    const g = readColorComponent(colors, index, 1);
    const b = readColorComponent(colors, index, 2);
    const cutDistance = (r - cut.r) ** 2 + (g - cut.g) ** 2 + (b - cut.b) ** 2;
    const stockDistance = (r - stockSource.r) ** 2 + (g - stockSource.g) ** 2 + (b - stockSource.b) ** 2;
    const color = cutDistance < stockDistance ? cut : stock;
    const shouldRemap = Math.min(cutDistance, stockDistance) <= 0.03;
    nextColors[index * 3] = shouldRemap ? color.r : r;
    nextColors[index * 3 + 1] = shouldRemap ? color.g : g;
    nextColors[index * 3 + 2] = shouldRemap ? color.b : b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(nextColors, 3));
}

function setObjectWireframe(object: THREE.Object3D | null, enabled: boolean) {
  if (!object) {
    return;
  }
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.wireframe = enabled;
        material.needsUpdate = true;
      }
    }
  });
}

function createStepSurfaceRenderGeometry(
  sourceGeometry: THREE.BufferGeometry,
  faceRanges: ReadonlyArray<StepFaceRange>,
) {
  const weldedGeometry = mergeVertices(sourceGeometry.clone());
  weldedGeometry.deleteAttribute("normal");

  const position = weldedGeometry.getAttribute("position");
  const index = weldedGeometry.getIndex();
  if (!position || !index) {
    weldedGeometry.computeVertexNormals();
    return weldedGeometry;
  }

  const normalSums = new Map<string, THREE.Vector3>();
  const triangleNormals = new Map<number, THREE.Vector3>();

  for (const range of faceRanges) {
    for (let triangleIndex = range.firstTriangle; triangleIndex < range.lastTriangleExclusive; triangleIndex += 1) {
      const aIndex = index.getX(triangleIndex * 3);
      const bIndex = index.getX(triangleIndex * 3 + 1);
      const cIndex = index.getX(triangleIndex * 3 + 2);
      const a = new THREE.Vector3().fromBufferAttribute(position, aIndex);
      const b = new THREE.Vector3().fromBufferAttribute(position, bIndex);
      const c = new THREE.Vector3().fromBufferAttribute(position, cIndex);
      const normal = new THREE.Vector3().crossVectors(
        b.sub(a),
        c.sub(a),
      );

      triangleNormals.set(triangleIndex, normal.clone().normalize());
      for (const vertexIndex of [aIndex, bIndex, cIndex]) {
        const key = `${range.faceIndex}:${vertexIndex}`;
        const sum = normalSums.get(key);
        if (sum) {
          sum.add(normal);
        } else {
          normalSums.set(key, normal.clone());
        }
      }
    }
  }

  const renderGeometry = weldedGeometry.toNonIndexed();
  weldedGeometry.dispose();
  const renderPosition = renderGeometry.getAttribute("position");
  const normals = new Float32Array(renderPosition.count * 3);

  for (const range of faceRanges) {
    for (let triangleIndex = range.firstTriangle; triangleIndex < range.lastTriangleExclusive; triangleIndex += 1) {
      const fallback = triangleNormals.get(triangleIndex) ?? new THREE.Vector3(0, 0, 1);
      for (let corner = 0; corner < 3; corner += 1) {
        const sourceVertexIndex = index.getX(triangleIndex * 3 + corner);
        const key = `${range.faceIndex}:${sourceVertexIndex}`;
        const normal = normalSums.get(key)?.clone() ?? fallback.clone();
        if (normal.lengthSq() === 0) {
          normal.copy(fallback);
        } else {
          normal.normalize();
        }
        const renderVertexIndex = triangleIndex * 3 + corner;
        normals[renderVertexIndex * 3] = normal.x;
        normals[renderVertexIndex * 3 + 1] = normal.y;
        normals[renderVertexIndex * 3 + 2] = normal.z;
      }
    }
  }

  renderGeometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return renderGeometry;
}

export function usePolylineViewerScene(
  containerRef: RefObject<HTMLDivElement | null>,
  {
    meshUrl = null,
    secondaryMeshUrl = null,
    tertiaryMeshUrl = null,
    meshColor = 0x94a3b8,
    meshOpacity = 1,
    meshUseVertexColors = true,
    meshEdgeColor = 0x334155,
    secondaryMeshColor = 0xfb923c,
    secondaryMeshOpacity = 1,
    secondaryMeshUseVertexColors = true,
    secondaryMeshEdgeColor = null,
    tertiaryMeshColor = 0xf97316,
    tertiaryMeshOpacity = 1,
    tertiaryMeshUseVertexColors = true,
    tertiaryMeshEdgeColor = null,
    showMesh = true,
    showSecondaryMesh = true,
    showTertiaryMesh = true,
    showSimulationStock = true,
    showTool = true,
    polylines,
    faceSelectionMode = false,
    selectedMeshFace = null,
    selectedMeshFaces = [],
    simulationSamples = [],
    simulationStep = 0,
    simulationToolMeshUrl = null,
    simulationToolPosition = null,
    toolRenderMode = "wireframe",
    partRenderMode = "shaded",
    stockRenderMode = "shaded",
    showOriginalMesh = true,
    onMeshFaceSelect,
    onSecondaryMeshDisplayed,
    onSecondaryMeshLoadFailed,
    onTertiaryMeshDisplayed,
    onTertiaryMeshLoadFailed,
  }: PolylineViewerSceneProps,
) {
  const currentPolylinesRef = useRef(polylines);
  const renderedPolylinesRef = useRef<PolylineDefinition[]>([]);
  const lastSceneBoundsRef = useRef<THREE.Box3 | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const polylineGroupRef = useRef<THREE.Group | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const secondaryMeshGroupRef = useRef<THREE.Group | null>(null);
  const tertiaryMeshGroupRef = useRef<THREE.Group | null>(null);
  const meshRef = useRef<THREE.Mesh | null>(null);
  const meshSelectionMeshRef = useRef<THREE.Mesh | null>(null);
  const meshSelectionDataRef = useRef<MeshSelectionData | null>(null);
  const meshBoundsRef = useRef<THREE.Box3 | null>(null);
  const selectionHighlightGroupRef = useRef<THREE.Group | null>(null);
  const selectionOutlineMaterialRef = useRef<LineMaterial | null>(null);
  const edgeLoopPreviewRef = useRef<THREE.Object3D | null>(null);
  const edgeLoopPreviewMaterialRef = useRef<LineMaterial | null>(null);
  const hoveredEdgeLoopRef = useRef<StepEdgeLoop | null>(null);
  const stepEdgeLoopsRef = useRef<StepEdgeLoop[]>([]);
  const meshEdgeMaterialRef = useRef<LineMaterial | null>(null);
  const polylineMaterialsRef = useRef<LineMaterial[]>([]);
  const scsRendererRef = useRef<SCSRenderer | null>(null);
  const simulationDummyMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationToolPreviewMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationToolPlaceholderGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const simulationToolGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const simulationStockMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationCutterMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const simulationCuttersRef = useRef<THREE.Mesh[]>([]);
  const simulationPreparedStepRef = useRef(0);
  const faceSelectionModeRef = useRef(faceSelectionMode);
  const onMeshFaceSelectRef = useRef(onMeshFaceSelect);
  const selectedMeshFacesRef = useRef<ReadonlyArray<MeshFaceSelection>>(selectedMeshFaces.length > 0 ? selectedMeshFaces : selectedMeshFace ? [selectedMeshFace] : []);
  const simulationSamplesRef = useRef(simulationSamples);
  const simulationStepRef = useRef(simulationStep);
  const simulationToolPositionRef = useRef<PolylinePoint | null>(simulationToolPosition);
  const onSecondaryMeshDisplayedRef = useRef(onSecondaryMeshDisplayed);
  const onSecondaryMeshLoadFailedRef = useRef(onSecondaryMeshLoadFailed);
  const onTertiaryMeshDisplayedRef = useRef(onTertiaryMeshDisplayed);
  const onTertiaryMeshLoadFailedRef = useRef(onTertiaryMeshLoadFailed);
  const toolRenderModeRef = useRef<ToolRenderMode>(toolRenderMode);
  const partRenderModeRef = useRef<ToolRenderMode>(partRenderMode);
  const stockRenderModeRef = useRef<ToolRenderMode>(stockRenderMode);
  const showOriginalMeshRef = useRef(showOriginalMesh);
  const showMeshRef = useRef(showMesh);
  const showSecondaryMeshRef = useRef(showSecondaryMesh);
  const showTertiaryMeshRef = useRef(showTertiaryMesh);
  const showSimulationStockRef = useRef(showSimulationStock);
  const showToolRef = useRef(showTool);
  const hasUserInteractedRef = useRef(false);

  useEffect(() => {
    hasUserInteractedRef.current = false;
  }, [meshUrl]);

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
    selectedMeshFacesRef.current = selectedMeshFaces.length > 0 ? selectedMeshFaces : selectedMeshFace ? [selectedMeshFace] : [];
  }, [selectedMeshFace, selectedMeshFaces]);

  useEffect(() => {
    simulationToolPositionRef.current = simulationToolPosition;
  }, [simulationToolPosition]);

  useEffect(() => {
    onSecondaryMeshDisplayedRef.current = onSecondaryMeshDisplayed;
    onSecondaryMeshLoadFailedRef.current = onSecondaryMeshLoadFailed;
  }, [onSecondaryMeshDisplayed, onSecondaryMeshLoadFailed]);

  useEffect(() => {
    onTertiaryMeshDisplayedRef.current = onTertiaryMeshDisplayed;
    onTertiaryMeshLoadFailedRef.current = onTertiaryMeshLoadFailed;
  }, [onTertiaryMeshDisplayed, onTertiaryMeshLoadFailed]);

  useEffect(() => {
    toolRenderModeRef.current = toolRenderMode;
    const previewMesh = simulationToolPreviewMeshRef.current;
    if (!previewMesh) {
      return;
    }

    const material = previewMesh.material;
    if (material instanceof THREE.MeshStandardMaterial) {
      material.wireframe = toolRenderMode === "wireframe";
      material.needsUpdate = true;
    }
  }, [toolRenderMode]);

  useEffect(() => {
    partRenderModeRef.current = partRenderMode;
    setObjectWireframe(meshRef.current, partRenderMode === "wireframe");
  }, [partRenderMode]);

  useEffect(() => {
    stockRenderModeRef.current = stockRenderMode;
    const enabled = stockRenderMode === "wireframe";
    setObjectWireframe(secondaryMeshGroupRef.current, enabled);
    setObjectWireframe(tertiaryMeshGroupRef.current, enabled);
    setObjectWireframe(simulationStockMeshRef.current, enabled);
  }, [stockRenderMode]);

  useEffect(() => {
    showOriginalMeshRef.current = showOriginalMesh;
  }, [showOriginalMesh]);

  useEffect(() => {
    showMeshRef.current = showMesh;
    if (meshGroupRef.current) meshGroupRef.current.visible = showMesh;
  }, [showMesh]);

  useEffect(() => {
    showSecondaryMeshRef.current = showSecondaryMesh;
    if (secondaryMeshGroupRef.current) secondaryMeshGroupRef.current.visible = showSecondaryMesh;
  }, [showSecondaryMesh]);

  useEffect(() => {
    showTertiaryMeshRef.current = showTertiaryMesh;
    if (tertiaryMeshGroupRef.current) tertiaryMeshGroupRef.current.visible = showTertiaryMesh;
  }, [showTertiaryMesh]);

  useEffect(() => {
    showSimulationStockRef.current = showSimulationStock;
  }, [showSimulationStock]);


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

  const clearEdgeLoopPreview = useCallback(() => {
    const preview = edgeLoopPreviewRef.current;
    if (preview) {
      preview.parent?.remove(preview);
      disposeObject(preview);
      edgeLoopPreviewRef.current = null;
    }
    edgeLoopPreviewMaterialRef.current = null;
    hoveredEdgeLoopRef.current = null;
  }, []);

  const resetPrimaryMeshRefs = useCallback(() => {
    clearEdgeLoopPreview();
    meshRef.current = null;
    meshSelectionMeshRef.current = null;
    meshSelectionDataRef.current = null;
    meshBoundsRef.current = null;
    selectionHighlightGroupRef.current = null;
    selectionOutlineMaterialRef.current = null;
    stepEdgeLoopsRef.current = [];
    meshEdgeMaterialRef.current = null;
  }, [clearEdgeLoopPreview]);

  const commitPrimaryMesh = useCallback(
    (targetGroup: THREE.Group, loadedMesh: LoadedDisplayMesh) => {
      resetPrimaryMeshRefs();
      clearGroup(targetGroup);
      targetGroup.add(loadedMesh.group);
      meshRef.current = loadedMesh.mesh;
      meshSelectionMeshRef.current = loadedMesh.selectionMesh;
      meshSelectionDataRef.current = loadedMesh.selectionData;
      meshBoundsRef.current = loadedMesh.bounds?.clone() ?? null;
      selectionHighlightGroupRef.current = loadedMesh.selectionHighlightGroup;
      stepEdgeLoopsRef.current = loadedMesh.stepEdgeLoops;
      meshEdgeMaterialRef.current = loadedMesh.edgeMaterial;
    },
    [resetPrimaryMeshRefs],
  );

  const swapGroupContents = useCallback((targetGroup: THREE.Group, nextGroup: THREE.Group) => {
    targetGroup.add(nextGroup);
    while (targetGroup.children.length > 1) {
      const child = targetGroup.children[0];
      targetGroup.remove(child);
      disposeObject(child);
    }
  }, []);

  const loadDisplayMeshIntoGroup = useCallback(
    async (
      sourceUrl: string,
      color: number,
      edgeColor: number | null,
      opacity: number,
      useVertexColors: boolean,
      renderer: THREE.WebGLRenderer,
      enableSelection: boolean,
      cancelled: () => boolean,
      wireframe = false,
    ) => {
      const targetGroup = new THREE.Group();
      const sourceGeometry = await loadMeshGeometry(sourceUrl);

      if (cancelled()) {
        sourceGeometry.dispose();
        return null;
      }

      const stepFaceRanges = sourceGeometry.userData.stepFaceRanges as StepFaceRange[] | undefined;
      if (stepFaceRanges?.length) {
        // Smooth each original CAD surface independently: curved surfaces stay smooth,
        // while adjacent STEP faces never blend their normals at sharp boundaries.
        const renderGeometry = createStepSurfaceRenderGeometry(sourceGeometry, stepFaceRanges);

        // Render geometry is non-indexed so each CAD surface can have its own smooth
        // normals. Keep an index so STEP face ranges and edge-loop picking still work.
        const renderVertexCount = renderGeometry.getAttribute("position").count;
        const renderIndices = new Uint32Array(renderVertexCount);
        for (let index = 0; index < renderVertexCount; index += 1) {
          renderIndices[index] = index;
        }
        renderGeometry.setIndex(new THREE.BufferAttribute(renderIndices, 1));
        renderGeometry.computeBoundingBox();
        renderGeometry.computeBoundingSphere();

        const clampedOpacity = Math.max(0, Math.min(opacity, 1));
        const mesh = new THREE.Mesh(
          renderGeometry,
          new THREE.MeshStandardMaterial({
            side: THREE.DoubleSide,
            color,
            roughness: 0.72,
            metalness: 0.02,
            transparent: clampedOpacity < 1,
            opacity: clampedOpacity,
            depthWrite: clampedOpacity >= 1,
            polygonOffset: true,
            polygonOffsetFactor: 1,
            polygonOffsetUnits: 1,
            wireframe,
          }),
        );
        mesh.userData.stepFaceRanges = stepFaceRanges;
        mesh.renderOrder = clampedOpacity < 1 ? 3 : 1;
        mesh.frustumCulled = false;
        targetGroup.add(mesh);

        const edgeLines = edgeColor == null ? null : buildStepEdgeLines(sourceGeometry, stepFaceRanges, edgeColor);
        if (edgeLines) {
          targetGroup.add(edgeLines);
        }

        const selectionHighlightGroup = enableSelection ? new THREE.Group() : null;
        if (selectionHighlightGroup) {
          mesh.add(selectionHighlightGroup);
        }

        const stepEdgeLoops = enableSelection ? getStepEdgeLoops(mesh) : [];
        const bounds = renderGeometry.boundingBox?.clone() ?? null;
        sourceGeometry.dispose();

        return {
          group: targetGroup,
          mesh,
          bounds,
          edgeMaterial: null,
          selectionMesh: null,
          selectionData: null,
          selectionHighlightGroup,
          stepEdgeLoops,
        } satisfies LoadedDisplayMesh;
      }

      sourceGeometry.deleteAttribute("normal");
      const weldedGeometry = mergeVertices(sourceGeometry);
      sourceGeometry.dispose();
      weldedGeometry.computeBoundingBox();
      weldedGeometry.computeBoundingSphere();

      const renderGeometry = toCreasedNormals(
        weldedGeometry.clone(),
        THREE.MathUtils.degToRad(DISPLAY_SHADING_CREASE_ANGLE_DEGREES),
      );
      renderGeometry.computeBoundingBox();
      renderGeometry.computeBoundingSphere();

      const clampedOpacity = Math.max(0, Math.min(opacity, 1));
      const hasVertexColors = useVertexColors && hasNonWhiteVertexColors(renderGeometry);
      if (hasVertexColors) {
        applyStockVertexColor(renderGeometry, color);
      }
      const meshMaterial = new THREE.MeshStandardMaterial({
        side: THREE.DoubleSide,
        color: hasVertexColors ? 0xffffff : color,
        vertexColors: hasVertexColors,
        roughness: 0.72,
        metalness: 0.02,
        transparent: clampedOpacity < 1,
        opacity: clampedOpacity,
        depthWrite: clampedOpacity >= 1,
        depthFunc: THREE.LessEqualDepth,
        wireframe,
      });
      const mesh = new THREE.Mesh(renderGeometry, meshMaterial);
      mesh.renderOrder = clampedOpacity < 1 ? 3 : 1;
      mesh.frustumCulled = false;
      targetGroup.add(mesh);

      let loadedEdgeMaterial: LineMaterial | null = null;
      if (edgeColor != null) {
        const edgeGeometry = new THREE.EdgesGeometry(
          weldedGeometry,
          DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES,
        );
        const edgePositions = edgeGeometry.getAttribute("position");
        const edgeSegmentsGeometry = new LineSegmentsGeometry();
        edgeSegmentsGeometry.setPositions(
          Array.from(edgePositions.array as Iterable<number>),
        );
        edgeGeometry.dispose();

        const edgeMaterial = new LineMaterial({
          color: edgeColor,
          linewidth: MESH_EDGE_LINEWIDTH,
          transparent: true,
          opacity: 0.9,
          depthTest: true,
          depthWrite: false,
        });
        edgeMaterial.alphaToCoverage = true;
        edgeMaterial.resolution.set(
          renderer.domElement.clientWidth,
          renderer.domElement.clientHeight,
        );

        const edgeLine = new LineSegments2(edgeSegmentsGeometry, edgeMaterial);
        edgeLine.renderOrder = 2;
        edgeLine.frustumCulled = false;
        targetGroup.add(edgeLine);
        loadedEdgeMaterial = edgeMaterial;
      }

      if (!enableSelection) {
        weldedGeometry.dispose();
        return {
          group: targetGroup,
          mesh,
          bounds: renderGeometry.boundingBox?.clone() ?? null,
          edgeMaterial: loadedEdgeMaterial,
          selectionMesh: null,
          selectionData: null,
          selectionHighlightGroup: null,
          stepEdgeLoops: [],
        } satisfies LoadedDisplayMesh;
      }

      const selectionMeshMaterial = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0,
        depthTest: false,
        depthWrite: false,
      });
      selectionMeshMaterial.colorWrite = false;
      const selectionMesh = new THREE.Mesh(weldedGeometry, selectionMeshMaterial);
      selectionMesh.frustumCulled = false;
      targetGroup.add(selectionMesh);

      const selectionHighlightGroup = new THREE.Group();
      mesh.add(selectionHighlightGroup);

      const selectionData = createMeshSelectionData(weldedGeometry);

      return {
        group: targetGroup,
        mesh,
        bounds: selectionData.bounds.clone(),
        edgeMaterial: loadedEdgeMaterial,
        selectionMesh,
        selectionData,
        selectionHighlightGroup,
        stepEdgeLoops: [],
      } satisfies LoadedDisplayMesh;
    },
    [],
  );

  const updateToolPreview = useCallback(() => {
    const previewMesh = simulationToolPreviewMeshRef.current;
    const geometry = simulationToolGeometryRef.current;
    const samples = simulationSamplesRef.current;
    const step = simulationStepRef.current;
    const toolPosition = simulationToolPositionRef.current;

    if (!previewMesh || !showToolRef.current || !geometry) {
      if (previewMesh) {
        previewMesh.visible = false;
      }
      return;
    }

    previewMesh.scale.set(1, 1, 1);

    if (toolPosition) {
      previewMesh.position.set(toolPosition[0], toolPosition[1], toolPosition[2]);
      previewMesh.rotation.set(0, 0, 0);
      previewMesh.visible = true;
      previewMesh.updateMatrixWorld(true);
      return;
    }

    if (step <= 0 || samples.length === 0) {
      previewMesh.visible = false;
      return;
    }

    const sampleIndex = Math.min(step, samples.length) - 1;
    const sample = samples[sampleIndex];
    previewMesh.position.set(sample.x, sample.y, sample.z);
    previewMesh.rotation.set(0, 0, 0);
    previewMesh.visible = true;
    previewMesh.updateMatrixWorld(true);
  }, []);

  useEffect(() => {
    showToolRef.current = showTool;
    updateToolPreview();
  }, [showTool, updateToolPreview]);

  const prepareSimulationCutters = useCallback((targetStep: number) => {
    const geometry = simulationToolGeometryRef.current;
    const samples = simulationSamplesRef.current;
    const cutterMaterial = simulationCutterMaterialRef.current;

    if (!geometry || !cutterMaterial) {
      return;
    }

    const clampedTargetStep = Math.max(0, Math.min(targetStep, samples.length));
    for (
      let index = simulationPreparedStepRef.current;
      index < clampedTargetStep;
      index += 1
    ) {
      const sample = samples[index];
      const cutter = new THREE.Mesh(geometry, cutterMaterial);
      cutter.position.set(sample.x, sample.y, sample.z);
      cutter.rotation.set(0, 0, 0);
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

    const geometry = simulationToolGeometryRef.current;
    const samples = simulationSamplesRef.current;
    const bounds = meshBoundsRef.current;

    if (!bounds) {
      updateToolPreview();
      return;
    }

    simulationStockMeshRef.current = createSimulationStockMesh(bounds);
    setObjectWireframe(simulationStockMeshRef.current, stockRenderModeRef.current === "wireframe");

    if (!geometry || samples.length === 0) {
      updateToolPreview();
      return;
    }

    if (!simulationCutterMaterialRef.current) {
      simulationCutterMaterialRef.current = new THREE.MeshBasicMaterial({
        color: CUT_SURFACE_COLOR,
      });
    }

    prepareSimulationCutters(simulationStepRef.current);
    updateToolPreview();
  }, [clearSimulationResources, prepareSimulationCutters, updateToolPreview]);

  useEffect(() => {
    simulationSamplesRef.current = simulationSamples;
    rebuildSimulationResources();
  }, [rebuildSimulationResources, simulationSamples]);

  useEffect(() => {
    const previewMesh = simulationToolPreviewMeshRef.current;
    const placeholderGeometry = simulationToolPlaceholderGeometryRef.current;

    if (!previewMesh || !placeholderGeometry) {
      return undefined;
    }

    let cancelled = false;

    const clearLoadedToolGeometry = () => {
      if (!simulationToolGeometryRef.current) {
        return;
      }
      previewMesh.geometry = placeholderGeometry;
      simulationToolGeometryRef.current.dispose();
      simulationToolGeometryRef.current = null;
    };

    if (!simulationToolMeshUrl) {
      clearLoadedToolGeometry();
      rebuildSimulationResources();
      updateToolPreview();
      return undefined;
    }

    const loadToolMesh = async () => {
      try {
        const geometry = await loadMeshGeometry(simulationToolMeshUrl);
        if (cancelled) {
          geometry.dispose();
          return;
        }

        geometry.deleteAttribute("normal");
        const weldedGeometry = mergeVertices(geometry);
        geometry.dispose();

        const renderGeometry = toCreasedNormals(
          weldedGeometry,
          THREE.MathUtils.degToRad(DISPLAY_SHADING_CREASE_ANGLE_DEGREES),
        );
        renderGeometry.computeBoundingBox();
        renderGeometry.computeBoundingSphere();
        weldedGeometry.dispose();

        if (cancelled) {
          renderGeometry.dispose();
          return;
        }

        clearLoadedToolGeometry();
        previewMesh.geometry = renderGeometry;
        simulationToolGeometryRef.current = renderGeometry;
        rebuildSimulationResources();
        updateToolPreview();
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load tool mesh", error);
          clearLoadedToolGeometry();
          rebuildSimulationResources();
          updateToolPreview();
        }
      }
    };

    void loadToolMesh();

    return () => {
      cancelled = true;
    };
  }, [rebuildSimulationResources, simulationToolMeshUrl, updateToolPreview]);

  useEffect(() => {
    simulationStepRef.current = simulationStep;
    prepareSimulationCutters(simulationStep);
    updateToolPreview();
  }, [prepareSimulationCutters, simulationStep, updateToolPreview]);

  useEffect(() => {
    updateToolPreview();
  }, [simulationToolPosition, showOriginalMesh, updateToolPreview]);

  const showEdgeLoopPreview = useCallback((loop: StepEdgeLoop) => {
    if (hoveredEdgeLoopRef.current?.id === loop.id) {
      return;
    }

    const renderer = rendererRef.current;
    if (!renderer) {
      return;
    }

    clearEdgeLoopPreview();
    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(loop.positions);
    const material = new LineMaterial({
      color: 0x2563eb,
      linewidth: POLYLINE_LINEWIDTH,
      transparent: true,
      opacity: 1,
      depthTest: false,
      depthWrite: false,
    });
    material.alphaToCoverage = true;
    material.resolution.set(renderer.domElement.clientWidth, renderer.domElement.clientHeight);
    const line = new LineSegments2(geometry, material);
    line.renderOrder = 21;
    line.frustumCulled = false;
    loop.mesh.add(line);
    edgeLoopPreviewRef.current = line;
    edgeLoopPreviewMaterialRef.current = material;
    hoveredEdgeLoopRef.current = loop;
  }, [clearEdgeLoopPreview]);

  useEffect(() => {
    if (!faceSelectionMode) {
      clearEdgeLoopPreview();
    }
  }, [clearEdgeLoopPreview, faceSelectionMode]);

  const renderSelectionHighlight = useCallback((selections: ReadonlyArray<MeshFaceSelection>) => {
    const mesh = meshRef.current;
    const selectionHighlightGroup = selectionHighlightGroupRef.current;
    const renderer = rendererRef.current;
    const selectionData = meshSelectionDataRef.current;

    if (!selectionHighlightGroup) {
      return;
    }

    clearGroup(selectionHighlightGroup);
    selectionOutlineMaterialRef.current = null;

    if (!showMeshRef.current || !renderer) {
      return;
    }

    if (!mesh || !(mesh.geometry instanceof THREE.BufferGeometry)) {
      return;
    }

    for (const selection of selections) {
      if (!selection.boundaryLoop) {
        continue;
      }

      if (
        selectionData &&
        selection.triangleIndices.some(
          (triangleIndex) => triangleIndex < 0 || triangleIndex >= selectionData.triangles.length,
        )
      ) {
        continue;
      }

      const boundaryPositions = createBoundarySegments(selection.boundaryLoop);
      if (boundaryPositions.length === 0) {
        continue;
      }

      const outlineGeometry = new LineSegmentsGeometry();
      outlineGeometry.setPositions(boundaryPositions);

      const outlineMaterial = new LineMaterial({
        color: 0x22c55e,
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
      outline.renderOrder = 20;
      outline.frustumCulled = false;
      selectionHighlightGroup.add(outline);
      selectionOutlineMaterialRef.current = outlineMaterial;
    }
  }, []);

  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    if (!meshGroup) {
      return;
    }

    meshGroup.visible = showMesh;
    renderSelectionHighlight(selectedMeshFacesRef.current);
  }, [faceSelectionMode, renderSelectionHighlight, showMesh]);

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
    axesHelper.setColors(0xff0000, 0x00ff00, 0x0000ff);
    scene.add(axesHelper);

    const polylineGroup = new THREE.Group();
    scene.add(polylineGroup);
    polylineGroupRef.current = polylineGroup;

    const meshGroup = new THREE.Group();
    meshGroup.visible = showMeshRef.current;
    scene.add(meshGroup);
    meshGroupRef.current = meshGroup;

    const secondaryMeshGroup = new THREE.Group();
    secondaryMeshGroup.visible = showSecondaryMeshRef.current;
    scene.add(secondaryMeshGroup);
    secondaryMeshGroupRef.current = secondaryMeshGroup;

    const tertiaryMeshGroup = new THREE.Group();
    tertiaryMeshGroup.visible = showTertiaryMeshRef.current;
    scene.add(tertiaryMeshGroup);
    tertiaryMeshGroupRef.current = tertiaryMeshGroup;

    const simulationToolPlaceholderGeometry = new THREE.BufferGeometry();
    simulationToolPlaceholderGeometryRef.current = simulationToolPlaceholderGeometry;
    const simulationToolPreviewMesh = new THREE.Mesh(
      simulationToolPlaceholderGeometry,
      new THREE.MeshStandardMaterial({
        color: TOOL_PREVIEW_COLOR,
        transparent: true,
        opacity: 0.75,
        wireframe: toolRenderModeRef.current === "wireframe",
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

    const handlePointerMove = (event: PointerEvent) => {
      const currentCamera = cameraRef.current;
      const edgeLoops = stepEdgeLoopsRef.current;
      if (!faceSelectionModeRef.current || !currentCamera || edgeLoops.length === 0) {
        clearEdgeLoopPreview();
        return;
      }

      const loop = pickNearestStepEdgeLoop(event, edgeLoops, currentCamera, renderer.domElement);
      if (loop) {
        showEdgeLoopPreview(loop);
      } else {
        clearEdgeLoopPreview();
      }
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!faceSelectionModeRef.current || event.button !== 0) {
        return;
      }

      const currentCamera = cameraRef.current;
      if (!currentCamera) {
        return;
      }

      const edgeLoops = stepEdgeLoopsRef.current;
      if (edgeLoops.length > 0) {
        const loop = hoveredEdgeLoopRef.current ?? pickNearestStepEdgeLoop(event, edgeLoops, currentCamera, renderer.domElement);
        if (!loop) {
          return;
        }

        onMeshFaceSelectRef.current?.(stepEdgeLoopToSelection(loop));
        event.preventDefault();
        return;
      }

      const currentSelectionMesh = meshSelectionMeshRef.current;
      const selectionData = meshSelectionDataRef.current;

      if (!currentSelectionMesh || !selectionData) {
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

    renderer.domElement.addEventListener("pointermove", handlePointerMove);
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
      edgeLoopPreviewMaterialRef.current?.resolution.set(width, height);
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
      const sceneBounds = getSceneBounds(currentPolylinesRef.current, meshBoundsRef.current);
      if (!lastSceneBoundsRef.current || !sceneBoundsEquals(sceneBounds, lastSceneBoundsRef.current)) {
        lastSceneBoundsRef.current = sceneBounds.clone();
        updateCameraDepthRange(sceneBounds, camera, controls);
      }
      renderer.clear();
      renderer.render(scene, camera);

      const scsRenderer = scsRendererRef.current;
      const simulationStock = simulationStockMeshRef.current;
      const currentSimulationDummyMesh = simulationDummyMeshRef.current;

      if (showSimulationStockRef.current && simulationStock) {
        const activeCutters = simulationCuttersRef.current.slice(
          0,
          Math.min(simulationStepRef.current, simulationCuttersRef.current.length),
        );

        renderer.clearDepth();
        if (activeCutters.length === 0 || !scsRenderer || !currentSimulationDummyMesh) {
          renderer.render(simulationStock, camera);
        } else {
          scsRenderer.renderSubtract(
            scene,
            camera,
            simulationStock,
            activeCutters,
            currentSimulationDummyMesh,
          );
        }
      }

      renderer.clearDepth();
      renderer.render(polylineGroup, camera);

      animationFrame = window.requestAnimationFrame(render);
    };

    render();

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      controls.dispose();
      clearSimulationResources();
      simulationToolGeometryRef.current?.dispose();
      simulationToolPlaceholderGeometryRef.current?.dispose();
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
      renderedPolylinesRef.current = [];
      meshGroupRef.current = null;
      secondaryMeshGroupRef.current = null;
      tertiaryMeshGroupRef.current = null;
      meshRef.current = null;
      meshSelectionMeshRef.current = null;
      meshSelectionDataRef.current = null;
      meshBoundsRef.current = null;
      selectionHighlightGroupRef.current = null;
      selectionOutlineMaterialRef.current = null;
      edgeLoopPreviewRef.current = null;
      edgeLoopPreviewMaterialRef.current = null;
      hoveredEdgeLoopRef.current = null;
      stepEdgeLoopsRef.current = [];
      meshEdgeMaterialRef.current = null;
      polylineMaterialsRef.current = [];
      scsRendererRef.current = null;
      simulationDummyMeshRef.current = null;
      simulationToolPreviewMeshRef.current = null;
      simulationToolPlaceholderGeometryRef.current = null;
      simulationToolGeometryRef.current = null;
      simulationStockMeshRef.current = null;
      simulationCutterMaterialRef.current = null;
      simulationCuttersRef.current = [];
      simulationPreparedStepRef.current = 0;
    };
  }, [clearEdgeLoopPreview, clearSimulationResources, containerRef, renderSelectionHighlight, showEdgeLoopPreview]);

  useEffect(() => {
    const meshGroup = meshGroupRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const renderer = rendererRef.current;

    if (!meshGroup || !camera || !controls || !renderer) {
      return undefined;
    }

    if (!meshUrl) {
      clearGroup(meshGroup);
      clearSimulationResources();
      resetPrimaryMeshRefs();

      if (!hasUserInteractedRef.current) {
        fitCameraToBox(getSceneBounds(currentPolylinesRef.current), camera, controls);
      }

      return undefined;
    }

    let cancelled = false;

    const loadMesh = async () => {
      try {
        const result = await loadDisplayMeshIntoGroup(
          meshUrl,
          meshColor,
          meshEdgeColor,
          meshOpacity,
          meshUseVertexColors,
          renderer,
          true,
          () => cancelled,
          partRenderModeRef.current === "wireframe",
        );

        if (!result || cancelled) {
          if (result) {
            disposeObject(result.group);
          }
          return;
        }

        clearSimulationResources();
        commitPrimaryMesh(meshGroup, result);
        meshGroup.visible = showMeshRef.current;

        if (!hasUserInteractedRef.current && result.bounds) {
          const bounds = getSceneBounds(currentPolylinesRef.current, result.bounds);
          fitCameraToBox(bounds, camera, controls);
        }

        renderSelectionHighlight(selectedMeshFacesRef.current);
        rebuildSimulationResources();
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load mesh", error);
        }
      }
    };

    void loadMesh();

    return () => {
      cancelled = true;
    };
  }, [
    clearSimulationResources,
    commitPrimaryMesh,
    loadDisplayMeshIntoGroup,
    meshColor,
    meshEdgeColor,
    meshOpacity,
    meshUseVertexColors,
    meshUrl,
    rebuildSimulationResources,
    renderSelectionHighlight,
    resetPrimaryMeshRefs,
  ]);

  useEffect(() => {
    const secondaryMeshGroup = secondaryMeshGroupRef.current;
    const renderer = rendererRef.current;

    if (!secondaryMeshGroup || !renderer) {
      return undefined;
    }

    if (!secondaryMeshUrl) {
      clearGroup(secondaryMeshGroup);
      return undefined;
    }

    let cancelled = false;

    const loadSecondaryMesh = async () => {
      const startedAt = performance.now();

      try {
        const result = await loadDisplayMeshIntoGroup(
          secondaryMeshUrl,
          secondaryMeshColor,
          secondaryMeshEdgeColor,
          secondaryMeshOpacity,
          secondaryMeshUseVertexColors,
          renderer,
          false,
          () => cancelled,
          stockRenderModeRef.current === "wireframe",
        );

        if (!result || cancelled) {
          if (result) {
            disposeObject(result.group);
          }
          return;
        }

        swapGroupContents(secondaryMeshGroup, result.group);
        onSecondaryMeshDisplayedRef.current?.(secondaryMeshUrl, performance.now() - startedAt);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load secondary mesh", error);
          onSecondaryMeshLoadFailedRef.current?.(secondaryMeshUrl, error);
        }
      }
    };

    void loadSecondaryMesh();

    return () => {
      cancelled = true;
    };
  }, [
    loadDisplayMeshIntoGroup,
    secondaryMeshColor,
    secondaryMeshEdgeColor,
    secondaryMeshOpacity,
    secondaryMeshUseVertexColors,
    secondaryMeshUrl,
    swapGroupContents,
  ]);

  useEffect(() => {
    const tertiaryMeshGroup = tertiaryMeshGroupRef.current;
    const renderer = rendererRef.current;

    if (!tertiaryMeshGroup || !renderer) {
      return undefined;
    }

    if (!tertiaryMeshUrl) {
      clearGroup(tertiaryMeshGroup);
      return undefined;
    }

    let cancelled = false;

    const loadTertiaryMesh = async () => {
      const startedAt = performance.now();

      try {
        const result = await loadDisplayMeshIntoGroup(
          tertiaryMeshUrl,
          tertiaryMeshColor,
          tertiaryMeshEdgeColor,
          tertiaryMeshOpacity,
          tertiaryMeshUseVertexColors,
          renderer,
          false,
          () => cancelled,
          stockRenderModeRef.current === "wireframe",
        );

        if (!result || cancelled) {
          if (result) disposeObject(result.group);
          return;
        }

        swapGroupContents(tertiaryMeshGroup, result.group);
        onTertiaryMeshDisplayedRef.current?.(tertiaryMeshUrl, performance.now() - startedAt);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load tertiary mesh", error);
          onTertiaryMeshLoadFailedRef.current?.(tertiaryMeshUrl, error);
        }
      }
    };

    void loadTertiaryMesh();

    return () => {
      cancelled = true;
    };
  }, [
    loadDisplayMeshIntoGroup,
    swapGroupContents,
    tertiaryMeshColor,
    tertiaryMeshEdgeColor,
    tertiaryMeshOpacity,
    tertiaryMeshUrl,
    tertiaryMeshUseVertexColors,
  ]);

  useEffect(() => {
    const polylineGroup = polylineGroupRef.current;
    const renderer = rendererRef.current;

    if (!polylineGroup || !renderer) {
      return;
    }

    const visiblePolylines = polylines.filter((polyline) => polyline.points.length >= 2);
    const previousPolylines = renderedPolylinesRef.current;
    const overlayLift = getOverlayLift(meshBoundsRef.current ?? getSceneBounds(polylines, null));
    const camera = cameraRef.current;
    const controls = controlsRef.current;

    const structureChanged =
      previousPolylines.length !== visiblePolylines.length ||
      previousPolylines.some((polyline, index) => polyline.id !== visiblePolylines[index]?.id);

    if (structureChanged) {
      console.debug("[polylines] full rebuild", {
        previous: previousPolylines.map((polyline) => polyline.id),
        next: visiblePolylines.map((polyline) => polyline.id),
      });
      clearGroup(polylineGroup);
      polylineMaterialsRef.current = [];

      const bounds = getSceneBounds(polylines, meshBoundsRef.current);
      if (!hasUserInteractedRef.current && camera && controls) {
        fitCameraToBox(bounds, camera, controls);
      }
    }

    const reusableLines = structureChanged
      ? []
      : polylineGroup.children.filter((child): child is Line2 => child instanceof Line2);

    visiblePolylines.forEach((polyline, index) => {
      const color = polyline.color ?? POLYLINE_COLORS[index % POLYLINE_COLORS.length];
      const isClearanceMove = polyline.kind === "rapid";
      const previous = structureChanged ? undefined : previousPolylines[index];

      if (
        !structureChanged &&
        previous &&
        previous !== polyline &&
        reusableLines[index] &&
        previous.points.length === polyline.points.length
      ) {
        const positions = polyline.points.flatMap(([x, y, z]) => [x, y, z + overlayLift]);
        const line = reusableLines[index];
        line.geometry.dispose();
        const lineGeometry = new LineGeometry();
        lineGeometry.setPositions(positions);
        lineGeometry.computeBoundingSphere();
        line.geometry = lineGeometry;
        line.computeLineDistances();
        return;
      }

      if (!structureChanged && previous === polyline && reusableLines[index]) {
        return;
      }

      if (!structureChanged) {
        console.debug("[polylines] replace", {
          index,
          previousPoints: previous?.points.length ?? 0,
          nextPoints: polyline.points.length,
          id: polyline.id,
        });
      }

      const positions = polyline.points.flatMap(([x, y, z]) => [x, y, z + overlayLift]);
      const lineGeometry = new LineGeometry();
      lineGeometry.setPositions(positions);
      lineGeometry.computeBoundingSphere();

      const lineMaterial = new LineMaterial({
        color,
        linewidth: isClearanceMove ? CLEARANCE_POLYLINE_LINEWIDTH : POLYLINE_LINEWIDTH,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      lineMaterial.alphaToCoverage = false;
      lineMaterial.resolution.set(
        renderer.domElement.clientWidth,
        renderer.domElement.clientHeight,
      );

      const line = new Line2(lineGeometry, lineMaterial);
      line.computeLineDistances();
      line.renderOrder = isClearanceMove ? 41 : 40;
      line.frustumCulled = false;

      if (!structureChanged && reusableLines[index]) {
        const old = reusableLines[index];
        polylineGroup.remove(old);
        old.geometry.dispose();
        const oldMaterial = old.material;
        if (!Array.isArray(oldMaterial)) {
          oldMaterial.dispose();
        }
        const materialIndex = polylineMaterialsRef.current.indexOf(oldMaterial as LineMaterial);
        if (materialIndex >= 0) {
          polylineMaterialsRef.current.splice(materialIndex, 1);
        }
        polylineGroup.add(line);
        polylineMaterialsRef.current.push(lineMaterial);
        return;
      }

      polylineGroup.add(line);
      polylineMaterialsRef.current.push(lineMaterial);
    });

    renderedPolylinesRef.current = visiblePolylines;
  }, [polylines]);

  useEffect(() => {
    renderSelectionHighlight(selectedMeshFacesRef.current);
  }, [renderSelectionHighlight, selectedMeshFace, selectedMeshFaces]);
}
