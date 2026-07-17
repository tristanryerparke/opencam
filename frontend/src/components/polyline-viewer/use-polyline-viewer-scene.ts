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
  MESH_DEPTH_OFFSET_FACTOR,
  MESH_DEPTH_OFFSET_UNITS,
  MESH_EDGE_LINEWIDTH,
  POLYLINE_COLORS,
  POLYLINE_LINEWIDTH,
  TOOL_PREVIEW_COLOR,
} from "./constants";
import { loadMeshGeometry } from "./mesh-loader";
import {
  createBoundarySegments,
  createMeshFaceSelection,
  createMeshSelectionData,
  type MeshSelectionData,
} from "./mesh-selection";
import {
  clearGroup,
  disposeObject,
  fitCameraToBox,
  getOverlayLift,
  getSceneBounds,
  updateCameraDepthRange,
} from "./scene-utils";
import {
  createBaseSimulationCylinderGeometry,
  createSimulationStockMesh,
} from "./simulation";
import type { MeshFaceSelection, PolylinePoint, PolylineViewerSceneProps } from "./types";

type LoadedDisplayMesh = {
  group: THREE.Group;
  mesh: THREE.Mesh;
  bounds: THREE.Box3 | null;
  edgeMaterial: LineMaterial | null;
  selectionMesh: THREE.Mesh | null;
  selectionData: MeshSelectionData | null;
  selectionHighlightGroup: THREE.Group | null;
};

export function usePolylineViewerScene(
  containerRef: RefObject<HTMLDivElement | null>,
  {
    meshUrl = null,
    secondaryMeshUrl = null,
    meshColor = 0x94a3b8,
    meshOpacity = 1,
    meshUseVertexColors = true,
    meshEdgeColor = 0x334155,
    secondaryMeshColor = 0xfb923c,
    secondaryMeshOpacity = 1,
    secondaryMeshUseVertexColors = true,
    secondaryMeshEdgeColor = null,
    polylines,
    faceSelectionMode = false,
    selectedMeshFace = null,
    selectedMeshFaces = [],
    simulationTool = null,
    simulationSamples = [],
    simulationStep = 0,
    simulationToolMeshUrl = null,
    simulationToolPosition = null,
    simulationToolRotation = null,
    simulationToolRotationEnabled = true,
    showOriginalMesh = true,
    onMeshFaceSelect,
  }: PolylineViewerSceneProps,
) {
  const currentPolylinesRef = useRef(polylines);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const polylineGroupRef = useRef<THREE.Group | null>(null);
  const meshGroupRef = useRef<THREE.Group | null>(null);
  const secondaryMeshGroupRef = useRef<THREE.Group | null>(null);
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
  const simulationToolPreviewBaseGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const simulationToolPreviewLoadedGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const simulationStockMeshRef = useRef<THREE.Mesh | null>(null);
  const simulationCutterGeometryRef = useRef<THREE.BufferGeometry | null>(null);
  const simulationCutterMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const simulationCuttersRef = useRef<THREE.Mesh[]>([]);
  const simulationPreparedStepRef = useRef(0);
  const simulationToolRotationRef = useRef(0);
  const faceSelectionModeRef = useRef(faceSelectionMode);
  const onMeshFaceSelectRef = useRef(onMeshFaceSelect);
  const selectedMeshFacesRef = useRef<ReadonlyArray<MeshFaceSelection>>(selectedMeshFaces.length > 0 ? selectedMeshFaces : selectedMeshFace ? [selectedMeshFace] : []);
  const simulationToolRef = useRef(simulationTool);
  const simulationSamplesRef = useRef(simulationSamples);
  const simulationStepRef = useRef(simulationStep);
  const simulationToolPositionRef = useRef<PolylinePoint | null>(simulationToolPosition);
  const simulationToolRotationPropRef = useRef<number | null>(simulationToolRotation);
  const simulationToolRotationEnabledRef = useRef(simulationToolRotationEnabled);
  const showOriginalMeshRef = useRef(showOriginalMesh);
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
    selectedMeshFacesRef.current = selectedMeshFaces.length > 0 ? selectedMeshFaces : selectedMeshFace ? [selectedMeshFace] : [];
  }, [selectedMeshFace, selectedMeshFaces]);

  useEffect(() => {
    simulationToolPositionRef.current = simulationToolPosition;
  }, [simulationToolPosition]);

  useEffect(() => {
    simulationToolRotationPropRef.current = simulationToolRotation;
  }, [simulationToolRotation]);

  useEffect(() => {
    simulationToolRotationEnabledRef.current = simulationToolRotationEnabled;
  }, [simulationToolRotationEnabled]);

  useEffect(() => {
    showOriginalMeshRef.current = showOriginalMesh;
  }, [showOriginalMesh]);

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

  const resetPrimaryMeshRefs = useCallback(() => {
    meshRef.current = null;
    meshSelectionMeshRef.current = null;
    meshSelectionDataRef.current = null;
    meshBoundsRef.current = null;
    selectionHighlightGroupRef.current = null;
    selectionOutlineMaterialRef.current = null;
    meshEdgeMaterialRef.current = null;
  }, []);

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
    ) => {
      const targetGroup = new THREE.Group();
      const sourceGeometry = await loadMeshGeometry(sourceUrl);

      if (cancelled()) {
        sourceGeometry.dispose();
        return null;
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
      if (clampedOpacity >= 1) {
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
        targetGroup.add(depthMesh);
      }

      const hasVertexColors = useVertexColors && renderGeometry.hasAttribute("color");
      const meshMaterial = new THREE.MeshStandardMaterial({
        color: hasVertexColors ? 0xffffff : color,
        vertexColors: hasVertexColors,
        roughness: 0.72,
        metalness: 0.02,
        transparent: clampedOpacity < 1,
        opacity: clampedOpacity,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
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
      } satisfies LoadedDisplayMesh;
    },
    [],
  );

  const updateToolPreview = useCallback(() => {
    const previewMesh = simulationToolPreviewMeshRef.current;
    const tool = simulationToolRef.current;
    const samples = simulationSamplesRef.current;
    const step = simulationStepRef.current;
    const toolPosition = simulationToolPositionRef.current;
    const hasLoadedToolMesh = simulationToolPreviewLoadedGeometryRef.current != null;
    const explicitToolRotation = simulationToolRotationPropRef.current;
    const toolRotationEnabled = simulationToolRotationEnabledRef.current;

    const updateToolRotation = (
      currentPosition: PolylinePoint,
      previousPosition: PolylinePoint | null,
      nextPosition: PolylinePoint | null,
    ) => {
      const candidateVectors: PolylinePoint[] = [];

      if (previousPosition) {
        candidateVectors.push([
          currentPosition[0] - previousPosition[0],
          currentPosition[1] - previousPosition[1],
          currentPosition[2] - previousPosition[2],
        ]);
      }

      if (nextPosition) {
        candidateVectors.push([
          nextPosition[0] - currentPosition[0],
          nextPosition[1] - currentPosition[1],
          nextPosition[2] - currentPosition[2],
        ]);
      }

      for (const [dx, dy] of candidateVectors) {
        if (Math.hypot(dx, dy) <= 1e-6) {
          continue;
        }
        simulationToolRotationRef.current = Math.atan2(dy, dx);
        break;
      }

      if (previewMesh) {
        previewMesh.rotation.set(0, 0, simulationToolRotationRef.current);
      }
    };

    if (!previewMesh || showOriginalMeshRef.current) {
      if (previewMesh) {
        previewMesh.visible = false;
      }
      return;
    }

    if (toolPosition) {
      const previousSample = step > 0 && step - 1 < samples.length
        ? samples[Math.max(step - 1, 0)]
        : null;
      const nextSample = step < samples.length ? samples[step] : null;

      if (hasLoadedToolMesh) {
        previewMesh.scale.set(1, 1, 1);
        previewMesh.position.set(toolPosition[0], toolPosition[1], toolPosition[2]);
      } else if (tool) {
        previewMesh.scale.set(tool.diameter, tool.diameter, tool.cuttingHeight);
        previewMesh.position.set(
          toolPosition[0],
          toolPosition[1],
          toolPosition[2] + tool.cuttingHeight / 2,
        );
      } else {
        previewMesh.visible = false;
        return;
      }

      if (!toolRotationEnabled) {
        simulationToolRotationRef.current = 0;
        previewMesh.rotation.set(0, 0, 0);
      } else if (explicitToolRotation != null) {
        simulationToolRotationRef.current = explicitToolRotation;
        previewMesh.rotation.set(0, 0, simulationToolRotationRef.current);
      } else {
        updateToolRotation(
          toolPosition,
          previousSample ? [previousSample.x, previousSample.y, previousSample.z] : null,
          nextSample ? [nextSample.x, nextSample.y, nextSample.z] : null,
        );
      }
      previewMesh.visible = true;
      previewMesh.updateMatrixWorld(true);
      return;
    }

    if (!tool || step <= 0 || samples.length === 0) {
      previewMesh.visible = false;
      return;
    }

    const sampleIndex = Math.min(step, samples.length) - 1;
    const sample = samples[sampleIndex];
    const previousSample = sampleIndex > 0 ? samples[sampleIndex - 1] : null;
    const nextSample = sampleIndex + 1 < samples.length ? samples[sampleIndex + 1] : null;
    previewMesh.scale.set(tool.diameter, tool.diameter, tool.cuttingHeight);
    previewMesh.position.set(sample.x, sample.y, sample.z + tool.cuttingHeight / 2);
    if (!toolRotationEnabled) {
      simulationToolRotationRef.current = 0;
      previewMesh.rotation.set(0, 0, 0);
    } else {
      updateToolRotation(
        [sample.x, sample.y, sample.z],
        previousSample ? [previousSample.x, previousSample.y, previousSample.z] : null,
        nextSample ? [nextSample.x, nextSample.y, nextSample.z] : null,
      );
    }
    previewMesh.visible = true;
    previewMesh.updateMatrixWorld(true);
  }, []);

  const prepareSimulationCutters = useCallback((targetStep: number) => {
    const tool = simulationToolRef.current;
    const samples = simulationSamplesRef.current;
    const baseGeometry = simulationCutterGeometryRef.current;
    const cutterMaterial = simulationCutterMaterialRef.current;
    const toolRotationEnabled = simulationToolRotationEnabledRef.current;

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
      const previousSample = index > 0 ? samples[index - 1] : null;
      const nextSample = index + 1 < samples.length ? samples[index + 1] : null;
      const cutter = new THREE.Mesh(baseGeometry, cutterMaterial);
      cutter.scale.set(tool.diameter, tool.diameter, tool.cuttingHeight);
      cutter.position.set(sample.x, sample.y, sample.z + tool.cuttingHeight / 2);

      if (toolRotationEnabled) {
        const candidateVectors: Array<readonly [number, number]> = [];
        if (previousSample) {
          candidateVectors.push([sample.x - previousSample.x, sample.y - previousSample.y]);
        }
        if (nextSample) {
          candidateVectors.push([nextSample.x - sample.x, nextSample.y - sample.y]);
        }
        for (const [dx, dy] of candidateVectors) {
          if (Math.hypot(dx, dy) <= 1e-6) {
            continue;
          }
          cutter.rotation.set(0, 0, Math.atan2(dy, dx));
          break;
        }
      } else {
        cutter.rotation.set(0, 0, 0);
      }

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
    simulationToolRotationEnabledRef.current = simulationToolRotationEnabled;
    rebuildSimulationResources();
  }, [rebuildSimulationResources, simulationSamples, simulationTool, simulationToolRotationEnabled]);

  useEffect(() => {
    const previewMesh = simulationToolPreviewMeshRef.current;
    const baseGeometry = simulationToolPreviewBaseGeometryRef.current;

    if (!previewMesh || !baseGeometry) {
      return undefined;
    }

    let cancelled = false;

    if (!simulationToolMeshUrl) {
      if (simulationToolPreviewLoadedGeometryRef.current) {
        previewMesh.geometry = baseGeometry;
        simulationToolPreviewLoadedGeometryRef.current.dispose();
        simulationToolPreviewLoadedGeometryRef.current = null;
      }
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

        if (simulationToolPreviewLoadedGeometryRef.current) {
          simulationToolPreviewLoadedGeometryRef.current.dispose();
        }

        previewMesh.geometry = renderGeometry;
        simulationToolPreviewLoadedGeometryRef.current = renderGeometry;
        updateToolPreview();
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load tool mesh", error);
        }
      }
    };

    void loadToolMesh();

    return () => {
      cancelled = true;
    };
  }, [simulationToolMeshUrl, updateToolPreview]);

  useEffect(() => {
    simulationStepRef.current = simulationStep;
    prepareSimulationCutters(simulationStep);
    updateToolPreview();
  }, [prepareSimulationCutters, simulationStep, updateToolPreview]);

  useEffect(() => {
    updateToolPreview();
  }, [simulationToolPosition, simulationToolRotation, simulationToolRotationEnabled, showOriginalMesh, updateToolPreview]);

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

    if (!showOriginalMeshRef.current || !renderer) {
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

    meshGroup.visible = true;
    renderSelectionHighlight(selectedMeshFacesRef.current);
  }, [faceSelectionMode, renderSelectionHighlight, showOriginalMesh]);

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

    const secondaryMeshGroup = new THREE.Group();
    scene.add(secondaryMeshGroup);
    secondaryMeshGroupRef.current = secondaryMeshGroup;

    const simulationToolPreviewGeometry = createBaseSimulationCylinderGeometry();
    simulationToolPreviewBaseGeometryRef.current = simulationToolPreviewGeometry;
    const simulationToolPreviewMesh = new THREE.Mesh(
      simulationToolPreviewGeometry,
      new THREE.MeshStandardMaterial({
        color: TOOL_PREVIEW_COLOR,
        transparent: true,
        opacity: 0.75,
        wireframe: true,
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
      const currentSimulationDummyMesh = simulationDummyMeshRef.current;

      if (scsRenderer && simulationStock && currentSimulationDummyMesh) {
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
          currentSimulationDummyMesh,
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

      const previewMesh = simulationToolPreviewMeshRef.current;
      const previewBaseGeometry = simulationToolPreviewBaseGeometryRef.current;
      if (previewMesh && previewBaseGeometry && previewMesh.geometry !== previewBaseGeometry) {
        previewBaseGeometry.dispose();
      }

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
      secondaryMeshGroupRef.current = null;
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
      simulationToolPreviewBaseGeometryRef.current = null;
      simulationToolPreviewLoadedGeometryRef.current = null;
      simulationStockMeshRef.current = null;
      simulationCutterGeometryRef.current = null;
      simulationCutterMaterialRef.current = null;
      simulationCuttersRef.current = [];
      simulationPreparedStepRef.current = 0;
    };
  }, [clearSimulationResources, containerRef, renderSelectionHighlight]);

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
        );

        if (!result || cancelled) {
          if (result) {
            disposeObject(result.group);
          }
          return;
        }

        clearSimulationResources();
        commitPrimaryMesh(meshGroup, result);
        meshGroup.visible = true;

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
    showOriginalMesh,
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
        );

        if (!result || cancelled) {
          if (result) {
            disposeObject(result.group);
          }
          return;
        }

        swapGroupContents(secondaryMeshGroup, result.group);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load secondary mesh", error);
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
      const isClearanceMove = polyline.kind === "rapid";

      if (polyline.points.length < 2) {
        return;
      }

      const positions = polyline.points.flatMap(([x, y, z]) => [x, y, z + overlayLift]);
      const lineGeometry = new LineGeometry();
      lineGeometry.setPositions(positions);

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

      const line = new Line2(lineGeometry, lineMaterial);
      line.renderOrder = 18;
      line.frustumCulled = false;
      polylineGroup.add(line);
      polylineMaterialsRef.current.push(lineMaterial);
    });
  }, [polylines]);

  useEffect(() => {
    renderSelectionHighlight(selectedMeshFacesRef.current);
  }, [renderSelectionHighlight, selectedMeshFace, selectedMeshFaces]);
}
