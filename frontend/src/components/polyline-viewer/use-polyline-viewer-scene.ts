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

export function usePolylineViewerScene(
  containerRef: RefObject<HTMLDivElement | null>,
  {
    meshUrl = null,
    secondaryMeshUrl = null,
    meshColor = 0x94a3b8,
    meshEdgeColor = 0x334155,
    secondaryMeshColor = 0xfb923c,
    secondaryMeshEdgeColor = null,
    polylines,
    faceSelectionMode = false,
    selectedMeshFace = null,
    simulationTool = null,
    simulationSamples = [],
    simulationStep = 0,
    simulationToolMeshUrl = null,
    simulationToolPosition = null,
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
  const simulationCutterGeometryRef = useRef<THREE.CylinderGeometry | null>(null);
  const simulationCutterMaterialRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const simulationCuttersRef = useRef<THREE.Mesh[]>([]);
  const simulationPreparedStepRef = useRef(0);
  const faceSelectionModeRef = useRef(faceSelectionMode);
  const onMeshFaceSelectRef = useRef(onMeshFaceSelect);
  const selectedMeshFaceRef = useRef(selectedMeshFace);
  const simulationToolRef = useRef(simulationTool);
  const simulationSamplesRef = useRef(simulationSamples);
  const simulationStepRef = useRef(simulationStep);
  const simulationToolPositionRef = useRef<PolylinePoint | null>(simulationToolPosition);
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
    selectedMeshFaceRef.current = selectedMeshFace;
  }, [selectedMeshFace]);

  useEffect(() => {
    simulationToolPositionRef.current = simulationToolPosition;
  }, [simulationToolPosition]);

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

  const loadDisplayMeshIntoGroup = useCallback(
    async (
      targetGroup: THREE.Group,
      sourceUrl: string,
      color: number,
      edgeColor: number | null,
      renderer: THREE.WebGLRenderer,
      enableSelection: boolean,
      cancelled: () => boolean,
    ) => {
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

      const meshMaterial = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.72,
        metalness: 0.02,
        depthWrite: false,
        depthFunc: THREE.LessEqualDepth,
      });
      const mesh = new THREE.Mesh(renderGeometry, meshMaterial);
      mesh.renderOrder = 1;
      mesh.frustumCulled = false;
      targetGroup.add(mesh);

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

        if (enableSelection) {
          meshEdgeMaterialRef.current = edgeMaterial;
        }
      }

      if (!enableSelection) {
        weldedGeometry.dispose();
        return { mesh, bounds: renderGeometry.boundingBox?.clone() ?? null };
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
      meshSelectionMeshRef.current = selectionMesh;

      const selectionHighlightGroup = new THREE.Group();
      mesh.add(selectionHighlightGroup);
      selectionHighlightGroupRef.current = selectionHighlightGroup;

      const selectionData = createMeshSelectionData(weldedGeometry);
      meshSelectionDataRef.current = selectionData;
      meshBoundsRef.current = selectionData.bounds.clone();
      meshRef.current = mesh;

      return { mesh, bounds: selectionData.bounds.clone() };
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

    if (!previewMesh || showOriginalMeshRef.current) {
      if (previewMesh) {
        previewMesh.visible = false;
      }
      return;
    }

    if (toolPosition) {
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

      previewMesh.visible = true;
      previewMesh.updateMatrixWorld(true);
      return;
    }

    if (!tool || step <= 0 || samples.length === 0) {
      previewMesh.visible = false;
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
        weldedGeometry.computeVertexNormals();

        if (cancelled) {
          weldedGeometry.dispose();
          return;
        }

        if (simulationToolPreviewLoadedGeometryRef.current) {
          simulationToolPreviewLoadedGeometryRef.current.dispose();
        }

        previewMesh.geometry = weldedGeometry;
        simulationToolPreviewLoadedGeometryRef.current = weldedGeometry;
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
  }, [simulationToolPosition, showOriginalMesh, updateToolPreview]);

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
      outline.renderOrder = 20;
      outline.frustumCulled = false;
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

    const secondaryMeshGroup = new THREE.Group();
    scene.add(secondaryMeshGroup);
    secondaryMeshGroupRef.current = secondaryMeshGroup;

    const simulationToolPreviewGeometry = createBaseSimulationCylinderGeometry();
    simulationToolPreviewBaseGeometryRef.current = simulationToolPreviewGeometry;
    const simulationToolPreviewMesh = new THREE.Mesh(
      simulationToolPreviewGeometry,
      new THREE.MeshStandardMaterial({
        color: TOOL_PREVIEW_COLOR,
        transparent: false,
        opacity: 1,
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
        const result = await loadDisplayMeshIntoGroup(
          meshGroup,
          meshUrl,
          meshColor,
          meshEdgeColor,
          renderer,
          true,
          () => cancelled,
        );

        if (!result || cancelled) {
          return;
        }

        meshGroup.visible =
          faceSelectionModeRef.current || showOriginalMeshRef.current || !simulationToolRef.current;

        if (!hasUserInteractedRef.current && result.bounds) {
          const bounds = getSceneBounds(currentPolylinesRef.current, result.bounds);
          fitCameraToBox(bounds, camera, controls);
        }

        renderSelectionHighlight(selectedMeshFaceRef.current);
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
  }, [
    clearSimulationResources,
    loadDisplayMeshIntoGroup,
    meshColor,
    meshEdgeColor,
    meshUrl,
    rebuildSimulationResources,
    renderSelectionHighlight,
    showOriginalMesh,
  ]);

  useEffect(() => {
    const secondaryMeshGroup = secondaryMeshGroupRef.current;
    const renderer = rendererRef.current;

    if (!secondaryMeshGroup || !renderer) {
      return undefined;
    }

    clearGroup(secondaryMeshGroup);

    let cancelled = false;
    if (!secondaryMeshUrl) {
      return undefined;
    }

    const loadSecondaryMesh = async () => {
      try {
        await loadDisplayMeshIntoGroup(
          secondaryMeshGroup,
          secondaryMeshUrl,
          secondaryMeshColor,
          secondaryMeshEdgeColor,
          renderer,
          false,
          () => cancelled,
        );
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load secondary mesh", error);
        }
      }
    };

    void loadSecondaryMesh();

    return () => {
      cancelled = true;
      clearGroup(secondaryMeshGroup);
    };
  }, [
    loadDisplayMeshIntoGroup,
    secondaryMeshColor,
    secondaryMeshEdgeColor,
    secondaryMeshUrl,
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
      const isClearanceMove = polyline.kind === "clearance";

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
    renderSelectionHighlight(selectedMeshFace);
  }, [renderSelectionHighlight, selectedMeshFace]);
}
