import { useCallback, useEffect, useRef, type RefObject } from "react";
import { ArcRotateCamera } from "@babylonjs/core/Cameras/arcRotateCamera";
import { Color3, Color4 } from "@babylonjs/core/Maths/math.color";
import { Constants } from "@babylonjs/core/Engines/constants";
import { Engine } from "@babylonjs/core/Engines/engine";
import { HemisphericLight } from "@babylonjs/core/Lights/hemisphericLight";
import { Mesh } from "@babylonjs/core/Meshes/mesh";
import { MeshBuilder } from "@babylonjs/core/Meshes/meshBuilder";
import { PointerEventTypes } from "@babylonjs/core/Events/pointerEvents";
import { Scene } from "@babylonjs/core/scene";
import { StandardMaterial } from "@babylonjs/core/Materials/standardMaterial";
import { TransformNode } from "@babylonjs/core/Meshes/transformNode";
import { Vector3 } from "@babylonjs/core/Maths/math.vector";
import { VertexBuffer } from "@babylonjs/core/Buffers/buffer";
import { CreateGreasedLine } from "@babylonjs/core/Meshes/Builders/greasedLineBuilder";
import { GreasedLineMeshMaterialType } from "@babylonjs/core/Materials/GreasedLine/greasedLineMaterialInterfaces";

import {
  CAMERA_FAR_RADIUS_MULTIPLIER,
  CAMERA_MAX_DISTANCE_MULTIPLIER,
  CAMERA_NEAR_DISTANCE_FACTOR,
  CAMERA_NEAR_SCENE_FACTOR,
  CLEARANCE_POLYLINE_LINEWIDTH,
  DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES,
  MESH_EDGE_LINEWIDTH,
  POLYLINE_COLORS,
  POLYLINE_LINEWIDTH,
} from "./constants";
import { importMesh, type ImportedMesh } from "./mesh-loader";
import {
  createBoundarySegments,
  createMeshFaceSelection,
  createMeshSelectionData,
  type MeshSelectionData,
} from "./mesh-selection";
import {
  getBoundsSize,
  getOverlayLift,
  getSceneBounds,
  unionBounds,
  type Bounds,
} from "./scene-utils";
import { createSimulationToolMesh } from "./simulation";
import type {
  MeshFaceSelection,
  PolylinePoint,
  PolylineViewerSceneProps,
} from "./types";

type DisplayMesh = {
  asset: ImportedMesh;
  bounds: Bounds | null;
  selectionData: Map<Mesh, MeshSelectionData>;
};

type ToolPreview = {
  root: TransformNode;
  fallback: Mesh;
  asset: ImportedMesh | null;
};

function colorFromNumber(color: number) {
  return Color3.FromHexString(`#${color.toString(16).padStart(6, "0")}`);
}

function colorFromString(color: string) {
  return color.startsWith("#") ? Color3.FromHexString(color) : Color3.White();
}

function boundsFromPositions(positions: Float32Array): Bounds | null {
  if (positions.length === 0) return null;

  const bounds: Bounds = {
    min: [positions[0], positions[1], positions[2]],
    max: [positions[0], positions[1], positions[2]],
  };
  for (let index = 3; index < positions.length; index += 3) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = positions[index + axis];
      bounds.min[axis] = Math.min(bounds.min[axis], value);
      bounds.max[axis] = Math.max(bounds.max[axis], value);
    }
  }
  return bounds;
}

function selectionDataForMesh(mesh: Mesh): MeshSelectionData | null {
  const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
  const indices = mesh.getIndices();
  if (!positions || !indices) return null;

  mesh.computeWorldMatrix(true);
  const matrix = mesh.getWorldMatrix();
  const transformed = new Float32Array(positions.length);
  const vertex = Vector3.Zero();
  for (let index = 0; index < positions.length; index += 3) {
    Vector3.TransformCoordinatesFromFloatsToRef(
      positions[index],
      positions[index + 1],
      positions[index + 2],
      matrix,
      vertex,
    );
    transformed[index] = vertex.x;
    transformed[index + 1] = vertex.y;
    transformed[index + 2] = vertex.z;
  }
  return createMeshSelectionData(transformed, indices);
}

function disposeDisplayMesh(display: DisplayMesh | null) {
  display?.asset.dispose();
}

function replaceMaterial(
  mesh: Mesh,
  scene: Scene,
  color: number,
  opacity: number,
  useVertexColors: boolean,
) {
  const previousMaterial = mesh.material;
  const material = new StandardMaterial(`${mesh.name}-display-material`, scene);
  material.diffuseColor = colorFromNumber(color);
  material.specularColor = new Color3(0.02, 0.02, 0.02);
  material.alpha = Math.min(1, Math.max(0, opacity));
  material.disableDepthWrite = material.alpha < 1;
  material.zOffset = -1;
  material.zOffsetUnits = -1;
  if (!useVertexColors || !mesh.getVerticesData(VertexBuffer.ColorKind)) {
    mesh.removeVerticesData(VertexBuffer.ColorKind);
  }
  mesh.material = material;
  previousMaterial?.dispose(true, true);
}

function createDisplayMesh(
  asset: ImportedMesh,
  scene: Scene,
  color: number,
  edgeColor: number | null,
  opacity: number,
  useVertexColors: boolean,
  selectable: boolean,
): DisplayMesh {
  const selectionData = new Map<Mesh, MeshSelectionData>();
  let bounds: Bounds | null = null;

  for (const mesh of asset.meshes) {
    replaceMaterial(mesh, scene, color, opacity, useVertexColors);
    mesh.renderingGroupId = 0;
    mesh.isPickable = selectable;

    if (edgeColor != null) {
      mesh.enableEdgesRendering(Math.cos((DISPLAY_EDGE_THRESHOLD_ANGLE_DEGREES * Math.PI) / 180));
      const edge = colorFromNumber(edgeColor);
      mesh.edgesColor = new Color4(edge.r, edge.g, edge.b, 0.9);
      mesh.edgesWidth = MESH_EDGE_LINEWIDTH;
    }

    if (!selectable) continue;
    const data = selectionDataForMesh(mesh);
    if (!data) continue;
    selectionData.set(mesh, data);
    const meshBounds = boundsFromPositions(data.positions);
    bounds = meshBounds ? (bounds ? unionBounds(bounds, meshBounds) : meshBounds) : bounds;
  }

  return { asset, bounds, selectionData };
}

function createOverlayLine(
  scene: Scene,
  name: string,
  points: ReadonlyArray<ReadonlyArray<number>>,
  color: Color3,
  width: number,
  renderingGroupId: number,
  alwaysOnTop = false,
) {
  const line = CreateGreasedLine(
    name,
    { points: points.map((point) => [...point]) },
    {
      materialType: GreasedLineMeshMaterialType.MATERIAL_TYPE_SIMPLE,
      color,
      width,
      sizeAttenuation: true,
    },
    scene,
  );
  line.renderingGroupId = renderingGroupId;
  line.isPickable = false;
  line.alwaysSelectAsActiveMesh = true;
  if (line.material) {
    line.material.disableDepthWrite = true;
    line.material.depthFunction = alwaysOnTop ? Constants.ALWAYS : Constants.LEQUAL;
  }
  return line;
}

function fitCameraToBounds(bounds: Bounds, camera: ArcRotateCamera) {
  const [width, depth, height] = getBoundsSize(bounds);
  const maxDimension = Math.max(width, depth, height, 1);
  const center = new Vector3(
    (bounds.min[0] + bounds.max[0]) / 2,
    (bounds.min[1] + bounds.max[1]) / 2,
    (bounds.min[2] + bounds.max[2]) / 2,
  );
  const distance = maxDimension / (2 * Math.tan((45 * Math.PI) / 360));

  camera.setTarget(center);
  camera.setPosition(new Vector3(
    center.x + distance * 1.35,
    center.y - distance * 1.1,
    center.z + distance * 0.9,
  ));
  camera.lowerRadiusLimit = Math.max(maxDimension * 0.0005, 0.01);
  camera.upperRadiusLimit = Math.max(maxDimension * CAMERA_MAX_DISTANCE_MULTIPLIER, distance * 2);
}

function updateCameraDepthRange(bounds: Bounds, camera: ArcRotateCamera) {
  const [width, depth, height] = getBoundsSize(bounds);
  const radius = Math.max(Math.hypot(width, depth, height) * 0.5, 0.5);
  const distance = Math.max(camera.radius, radius * 0.1, 0.01);
  camera.minZ = Math.max(0.001, distance * CAMERA_NEAR_DISTANCE_FACTOR, radius * CAMERA_NEAR_SCENE_FACTOR);
  camera.maxZ = Math.max(camera.minZ * 10, distance + radius * CAMERA_FAR_RADIUS_MULTIPLIER);
}

function createGridAndAxes(scene: Scene, bounds: Bounds) {
  const [width, depth, height] = getBoundsSize(bounds);
  const size = Math.max(120, Math.ceil(Math.max(width, depth, height, 1) * 1.8));
  const divisions = Math.max(10, Math.round(size / 12));
  const half = size / 2;
  const lines: Vector3[][] = [];

  for (let index = 0; index <= divisions; index += 1) {
    const position = -half + (size * index) / divisions;
    lines.push([new Vector3(position, -half, 0), new Vector3(position, half, 0)]);
    lines.push([new Vector3(-half, position, 0), new Vector3(half, position, 0)]);
  }

  const grid = MeshBuilder.CreateLineSystem("grid", { lines }, scene);
  grid.color = colorFromNumber(0x6b7280);
  grid.alpha = 0.45;
  grid.isPickable = false;

  const axisLength = Math.max(Math.max(width, depth, height) * 0.22, 18);
  for (const [name, end, color] of [
    ["x-axis", new Vector3(axisLength, 0, 0), Color3.Red()],
    ["y-axis", new Vector3(0, axisLength, 0), Color3.Green()],
    ["z-axis", new Vector3(0, 0, axisLength), Color3.Blue()],
  ] as const) {
    const axis = MeshBuilder.CreateLines(name, { points: [Vector3.Zero(), end] }, scene);
    axis.color = color;
    axis.isPickable = false;
  }
}

function toolRotation(
  current: PolylinePoint,
  previous: PolylinePoint | null,
  next: PolylinePoint | null,
  fallback: number,
) {
  for (const point of [previous, next]) {
    if (!point) continue;
    const [dx, dy] = point === previous
      ? [current[0] - point[0], current[1] - point[1]]
      : [point[0] - current[0], point[1] - current[1]];
    if (Math.hypot(dx, dy) > 1e-6) return Math.atan2(dy, dx);
  }
  return fallback;
}

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
  const engineRef = useRef<Engine | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const cameraRef = useRef<ArcRotateCamera | null>(null);
  const primaryMeshRef = useRef<DisplayMesh | null>(null);
  const secondaryMeshRef = useRef<DisplayMesh | null>(null);
  const polylineMeshesRef = useRef<Mesh[]>([]);
  const selectionMeshesRef = useRef<Mesh[]>([]);
  const toolPreviewRef = useRef<ToolPreview | null>(null);
  const selectedMeshFacesRef = useRef<ReadonlyArray<MeshFaceSelection>>(
    selectedMeshFaces.length > 0 ? selectedMeshFaces : selectedMeshFace ? [selectedMeshFace] : [],
  );
  const faceSelectionModeRef = useRef(faceSelectionMode);
  const onMeshFaceSelectRef = useRef(onMeshFaceSelect);
  const simulationToolRef = useRef(simulationTool);
  const simulationSamplesRef = useRef(simulationSamples);
  const simulationStepRef = useRef(simulationStep);
  const simulationToolPositionRef = useRef<PolylinePoint | null>(simulationToolPosition);
  const simulationToolRotationRef = useRef<number | null>(simulationToolRotation);
  const simulationToolRotationEnabledRef = useRef(simulationToolRotationEnabled);
  const showOriginalMeshRef = useRef(showOriginalMesh);
  const currentToolRotationRef = useRef(0);
  const hasUserInteractedRef = useRef(false);

  const clearSelectionHighlights = useCallback(() => {
    for (const mesh of selectionMeshesRef.current) mesh.dispose(false, true);
    selectionMeshesRef.current = [];
  }, []);

  const renderSelectionHighlights = useCallback(() => {
    clearSelectionHighlights();
    const scene = sceneRef.current;
    if (!scene || !showOriginalMeshRef.current) return;

    const lift = getOverlayLift(getSceneBounds(currentPolylinesRef.current, primaryMeshRef.current?.bounds));
    for (const selection of selectedMeshFacesRef.current) {
      if (!selection.boundaryLoop) continue;
      const segments = createBoundarySegments(selection.boundaryLoop).map(([x, y, z]) => [x, y, z + lift]);
      if (segments.length < 2) continue;
      selectionMeshesRef.current.push(createOverlayLine(
        scene,
        `${selection.id}-highlight`,
        segments,
        colorFromNumber(0x22c55e),
        POLYLINE_LINEWIDTH,
        3,
        true,
      ));
    }
  }, [clearSelectionHighlights]);

  const updateToolPreview = useCallback(() => {
    const preview = toolPreviewRef.current;
    if (!preview) return;

    if (showOriginalMeshRef.current) {
      preview.root.setEnabled(false);
      return;
    }

    const explicitPosition = simulationToolPositionRef.current;
    const samples = simulationSamplesRef.current;
    const step = simulationStepRef.current;
    const tool = simulationToolRef.current;
    let position = explicitPosition;
    let previous: PolylinePoint | null = null;
    let next: PolylinePoint | null = null;

    if (!position) {
      if (!tool || step <= 0 || samples.length === 0) {
        preview.root.setEnabled(false);
        return;
      }
      const index = Math.min(step, samples.length) - 1;
      const sample = samples[index];
      position = [sample.x, sample.y, sample.z];
      previous = index > 0 ? [samples[index - 1].x, samples[index - 1].y, samples[index - 1].z] : null;
      next = index + 1 < samples.length ? [samples[index + 1].x, samples[index + 1].y, samples[index + 1].z] : null;
    } else {
      previous = step > 0 && step - 1 < samples.length
        ? [samples[Math.max(step - 1, 0)].x, samples[Math.max(step - 1, 0)].y, samples[Math.max(step - 1, 0)].z]
        : null;
      next = step < samples.length ? [samples[step].x, samples[step].y, samples[step].z] : null;
    }

    if (!preview.asset && !tool) {
      preview.root.setEnabled(false);
      return;
    }

    const isCustomTool = preview.asset != null;
    preview.root.scaling.set(
      isCustomTool ? 1 : tool?.diameter ?? 1,
      isCustomTool ? 1 : tool?.diameter ?? 1,
      isCustomTool ? 1 : tool?.cuttingHeight ?? 1,
    );
    preview.root.position.set(
      position[0],
      position[1],
      position[2] + (isCustomTool ? 0 : (tool?.cuttingHeight ?? 0) / 2),
    );

    if (!simulationToolRotationEnabledRef.current) {
      currentToolRotationRef.current = 0;
    } else if (explicitPosition && simulationToolRotationRef.current != null) {
      currentToolRotationRef.current = simulationToolRotationRef.current;
    } else {
      currentToolRotationRef.current = toolRotation(
        position,
        previous,
        next,
        currentToolRotationRef.current,
      );
    }
    preview.root.rotation.set(0, 0, currentToolRotationRef.current);
    preview.root.setEnabled(true);
  }, []);

  useEffect(() => {
    currentPolylinesRef.current = polylines;
  }, [polylines]);

  useEffect(() => {
    faceSelectionModeRef.current = faceSelectionMode;
    engineRef.current?.getRenderingCanvas()?.style.setProperty(
      "cursor",
      faceSelectionMode ? "crosshair" : "default",
    );
  }, [faceSelectionMode]);

  useEffect(() => {
    onMeshFaceSelectRef.current = onMeshFaceSelect;
  }, [onMeshFaceSelect]);

  useEffect(() => {
    selectedMeshFacesRef.current = selectedMeshFaces.length > 0
      ? selectedMeshFaces
      : selectedMeshFace ? [selectedMeshFace] : [];
    renderSelectionHighlights();
  }, [renderSelectionHighlights, selectedMeshFace, selectedMeshFaces]);

  useEffect(() => {
    simulationToolRef.current = simulationTool;
    simulationSamplesRef.current = simulationSamples;
    simulationStepRef.current = simulationStep;
    simulationToolPositionRef.current = simulationToolPosition;
    simulationToolRotationRef.current = simulationToolRotation;
    simulationToolRotationEnabledRef.current = simulationToolRotationEnabled;
    updateToolPreview();
  }, [
    simulationSamples,
    simulationStep,
    simulationTool,
    simulationToolPosition,
    simulationToolRotation,
    simulationToolRotationEnabled,
    updateToolPreview,
  ]);

  useEffect(() => {
    showOriginalMeshRef.current = showOriginalMesh;
    renderSelectionHighlights();
    updateToolPreview();
  }, [renderSelectionHighlights, showOriginalMesh, updateToolPreview]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.height = "100%";
    canvas.style.width = "100%";
    canvas.style.cursor = faceSelectionModeRef.current ? "crosshair" : "default";
    container.appendChild(canvas);

    const engine = new Engine(canvas, true, { stencil: true });
    engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));
    const scene = new Scene(engine);
    scene.clearColor = new Color4(0, 0, 0, 0);
    scene.setRenderingAutoClearDepthStencil(2, false, false, false);
    scene.setRenderingAutoClearDepthStencil(3, false, false, false);
    engineRef.current = engine;
    sceneRef.current = scene;

    const camera = new ArcRotateCamera("camera", -Math.PI / 4, Math.PI / 3, 200, Vector3.Zero(), scene);
    camera.upVector = new Vector3(0, 0, 1);
    (camera.inputs.attached.pointers as unknown as { buttons: number[] }).buttons = [2];
    camera.attachControl(false, false, 1);
    camera.wheelDeltaPercentage = 0.01;
    camera.panningSensibility = 1000;
    cameraRef.current = camera;

    const light = new HemisphericLight("ambient-light", new Vector3(0, 0, 1), scene);
    light.intensity = 1.25;
    createGridAndAxes(scene, getSceneBounds(currentPolylinesRef.current));

    const previewRoot = new TransformNode("simulation-tool-preview-root", scene);
    const fallback = createSimulationToolMesh(scene);
    fallback.parent = previewRoot;
    previewRoot.setEnabled(false);
    toolPreviewRef.current = { root: previewRoot, fallback, asset: null };

    const pointerObserver = scene.onPointerObservable.add((pointerInfo) => {
      if (pointerInfo.type !== PointerEventTypes.POINTERDOWN) return;
      const event = pointerInfo.event as PointerEvent;
      if (event.button === 1 || event.button === 2) hasUserInteractedRef.current = true;
      if (!faceSelectionModeRef.current || event.button !== 0) return;

      const display = primaryMeshRef.current;
      const pick = scene.pick(
        scene.pointerX,
        scene.pointerY,
        (mesh) => mesh instanceof Mesh && Boolean(display?.selectionData.get(mesh)),
      );
      if (!pick?.hit || !(pick.pickedMesh instanceof Mesh) || pick.faceId == null) return;
      const selectionData = display?.selectionData.get(pick.pickedMesh);
      if (!selectionData) return;

      onMeshFaceSelectRef.current?.(createMeshFaceSelection(
        selectionData,
        pick.faceId,
      ));
      event.preventDefault();
    });

    const initialBounds = getSceneBounds(currentPolylinesRef.current);
    fitCameraToBounds(initialBounds, camera);
    engine.runRenderLoop(() => {
      updateCameraDepthRange(
        getSceneBounds(currentPolylinesRef.current, primaryMeshRef.current?.bounds),
        camera,
      );
      scene.render();
    });

    const resize = () => engine.resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();

    return () => {
      resizeObserver.disconnect();
      scene.onPointerObservable.remove(pointerObserver);
      engine.stopRenderLoop();
      clearSelectionHighlights();
      disposeDisplayMesh(primaryMeshRef.current);
      disposeDisplayMesh(secondaryMeshRef.current);
      for (const mesh of polylineMeshesRef.current) mesh.dispose(false, true);
      toolPreviewRef.current?.asset?.dispose();
      scene.dispose();
      engine.dispose();
      canvas.remove();
      engineRef.current = null;
      sceneRef.current = null;
      cameraRef.current = null;
      primaryMeshRef.current = null;
      secondaryMeshRef.current = null;
      polylineMeshesRef.current = [];
      toolPreviewRef.current = null;
    };
  }, [clearSelectionHighlights, containerRef]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene || !camera) return undefined;

    disposeDisplayMesh(primaryMeshRef.current);
    primaryMeshRef.current = null;
    clearSelectionHighlights();
    if (!meshUrl) {
      if (!hasUserInteractedRef.current) fitCameraToBounds(getSceneBounds(currentPolylinesRef.current), camera);
      return undefined;
    }

    let cancelled = false;
    void importMesh(meshUrl, scene)
      .then((asset) => {
        if (cancelled) {
          asset.dispose();
          return;
        }
        const display = createDisplayMesh(
          asset,
          scene,
          meshColor,
          meshEdgeColor,
          meshOpacity,
          meshUseVertexColors,
          true,
        );
        primaryMeshRef.current = display;
        if (!hasUserInteractedRef.current && display.bounds) {
          fitCameraToBounds(getSceneBounds(currentPolylinesRef.current, display.bounds), camera);
        }
        renderSelectionHighlights();
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("Failed to load mesh", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    clearSelectionHighlights,
    meshColor,
    meshEdgeColor,
    meshOpacity,
    meshUrl,
    meshUseVertexColors,
    renderSelectionHighlights,
  ]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return undefined;

    disposeDisplayMesh(secondaryMeshRef.current);
    secondaryMeshRef.current = null;
    if (!secondaryMeshUrl) return undefined;

    let cancelled = false;
    void importMesh(secondaryMeshUrl, scene)
      .then((asset) => {
        if (cancelled) {
          asset.dispose();
          return;
        }
        secondaryMeshRef.current = createDisplayMesh(
          asset,
          scene,
          secondaryMeshColor,
          secondaryMeshEdgeColor,
          secondaryMeshOpacity,
          secondaryMeshUseVertexColors,
          false,
        );
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("Failed to load secondary mesh", error);
      });

    return () => {
      cancelled = true;
    };
  }, [
    secondaryMeshColor,
    secondaryMeshEdgeColor,
    secondaryMeshOpacity,
    secondaryMeshUrl,
    secondaryMeshUseVertexColors,
  ]);

  useEffect(() => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    if (!scene) return;

    for (const mesh of polylineMeshesRef.current) mesh.dispose(false, true);
    polylineMeshesRef.current = [];
    const bounds = getSceneBounds(polylines, primaryMeshRef.current?.bounds);
    if (!hasUserInteractedRef.current && camera) fitCameraToBounds(bounds, camera);
    const lift = getOverlayLift(bounds);

    polylines.forEach((polyline, index) => {
      if (polyline.points.length < 2) return;
      const color = colorFromString(polyline.color ?? POLYLINE_COLORS[index % POLYLINE_COLORS.length]);
      const width = polyline.kind === "rapid" ? CLEARANCE_POLYLINE_LINEWIDTH : POLYLINE_LINEWIDTH;
      polylineMeshesRef.current.push(createOverlayLine(
        scene,
        polyline.id,
        polyline.points.map(([x, y, z]) => [x, y, z + lift]),
        color,
        width,
        2,
      ));
    });
  }, [polylines]);

  useEffect(() => {
    const scene = sceneRef.current;
    const preview = toolPreviewRef.current;
    if (!scene || !preview) return undefined;

    preview.asset?.dispose();
    preview.asset = null;
    preview.fallback.setEnabled(true);
    if (!simulationToolMeshUrl) {
      updateToolPreview();
      return undefined;
    }

    let cancelled = false;
    void importMesh(simulationToolMeshUrl, scene)
      .then((asset) => {
        if (cancelled) {
          asset.dispose();
          return;
        }
        for (const mesh of asset.meshes) {
          replaceMaterial(mesh, scene, 0x6b7280, 0.75, true);
          const material = mesh.material;
          if (material instanceof StandardMaterial) material.wireframe = true;
          mesh.isPickable = false;
          mesh.renderingGroupId = 2;
        }
        for (const root of asset.roots) root.parent = preview.root;
        preview.fallback.setEnabled(false);
        preview.asset = asset;
        updateToolPreview();
      })
      .catch((error: unknown) => {
        if (!cancelled) console.error("Failed to load tool mesh", error);
      });

    return () => {
      cancelled = true;
    };
  }, [simulationToolMeshUrl, updateToolPreview]);
}
