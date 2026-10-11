import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar, type RequestState } from "@/components/app-sidebar";
import { SettingsDialog } from "@/components/settings-dialog";
import { OperationDialog } from "@/components/operation-dialog";
import { OperationTypeDialog } from "@/components/operation-type-dialog";
import { SimulationDebugOverlay } from "@/components/simulation-debug-overlay";
import { VisibilityBar } from "@/components/viewport/visibility-bar";
import { AnimationBar } from "@/components/viewport/animation-bar";
import { SIMULATION_STRIDE_OPTIONS } from "@/components/viewport/simulation-constants";
import { PolylineViewer } from "@/components/polyline-viewer/viewer";
import type {
  MeshFaceSelection,
  PolylineDefinition,
  PolylinePoint,
} from "@/components/polyline-viewer/types";
import { Button } from "t-components/button";
import { X } from "lucide-react";
import { SidebarProvider, SidebarTrigger } from "t-components/sidebar";
import { getOpenCamBootstrap, sendRhinoUiDebug } from "@/bootstrap";
import type { DraftObject, Operation, OperationType } from "@/lib/cam-schema";
import {
  applySelectionToOperationDraft,
  buildGenerateToolpathRequest,
  createOperationDraft,
  getOperationSchema,
  parseOperationDraft,
} from "@/lib/cam-schema";
import { getBackendUrl } from "@/hooks/useBackendConnection";
import { useCamStore } from "@/state/cam-store";
import { useSettingsStore } from "@/state/settings-store";
import { useShallow } from "zustand/react/shallow";
import type { ClosedPolyline2D } from "@/generated_schemas/geometry_2d";
import type { ClosedPolyline25D } from "@/generated_schemas/geometry_2_5d";
import {
  linearizeOperationRecords,
  sampleOperationRecords,
  type OperationRecord3D,
  type PositionRecord3D,
} from "@/simulation/toolpath";

type GeneratedOperationResponse = OperationRecord3D;
type ToolPositionResponse = {
  x: number;
  y: number;
  z: number;
  comment?: string | null;
};

type SimulationChunkFrameResponse = {
  toolPosition: ToolPositionResponse;
  activeMeshIndex: number;
  clRecordIndex: number;
};

type SimulationChunkResponse = {
  cachedMeshUrl: string;
  frames: SimulationChunkFrameResponse[];
};

type SweptSimulationResponse = {
  simulationId: string;
  frameCount: number;
  chunkCount: number;
  toolMeshUrl: string;
  finalMeshUrl: string;
  chunks: SimulationChunkResponse[];
};

type SweptSimulationStartResponse = {
  taskId: string;
};

type SweptSimulationComparisonResponse = {
  cachedMeshUrl: string;
  activeMeshUrl: string;
};

type SweptSimulationStatusResponse = {
  taskId: string;
  status: "queued" | "running" | "cancelling" | "completed" | "cancelled" | "error";
  progressPercent: number;
  message?: string | null;
  errorDetail?: string | null;
  result?: SweptSimulationResponse | null;
};

type SimulationDisplayFrame = {
  activeMeshUrl: string;
  activeMeshKey: string;
  cachedMeshUrl: string;
  chunkIndex: number;
  sourceFrameIndex: number;
  toolPosition: ToolPositionResponse;
  clRecordIndex: number;
};

const CUT_PATH_COLOR = "#1d4ed8";
const LINK_PATH_COLOR = "#eab308";
const CLEARANCE_PATH_COLOR = "#dc2626";

type DisplayPathRole = "cutting" | "linking" | "travel";

function displayPathRole(record: PositionRecord3D): DisplayPathRole {
  if (record.motionRole === "linking") return "linking";
  if (record.motionRole === "travel" || record.feedType === "rapid") return "travel";
  return "cutting";
}

function createDisplayPolylines(sourceRecords: ReadonlyArray<PositionRecord3D>): PolylineDefinition[] {
  const records = linearizeOperationRecords(sourceRecords);
  const polylines: PolylineDefinition[] = [];
  let points: PolylinePoint[] = [];
  let role: DisplayPathRole | null = null;

  for (let index = 1; index < records.length; index += 1) {
    const start = records[index - 1];
    const end = records[index];
    const nextRole = displayPathRole(end);
    if (role !== nextRole) {
      points = [[start.x, start.y, start.z], [end.x, end.y, end.z]];
      role = nextRole;
      const name = role === "travel" ? "Rapid moves" : role === "linking" ? "Linking moves" : "Cutting moves";
      const color = role === "travel"
        ? CLEARANCE_PATH_COLOR
        : role === "linking"
          ? LINK_PATH_COLOR
          : CUT_PATH_COLOR;
      polylines.push({
        id: `record-${index}`,
        name,
        color,
        kind: role === "travel" ? "rapid" : "feed_rate",
        points,
      });
    } else {
      points.push([end.x, end.y, end.z]);
    }
  }

  return polylines;
}

function createSimulationFrameRecords(
  sourceRecords: ReadonlyArray<PositionRecord3D>,
  frames: ReadonlyArray<SimulationDisplayFrame>,
): PositionRecord3D[] {
  const records = linearizeOperationRecords(sourceRecords);
  if (records.length === 0) {
    return [];
  }

  const positionTolerance = 1e-5;
  const positionToleranceSq = positionTolerance * positionTolerance;
  let segmentCursor = 0;
  let template = records[0];

  return frames.map((frame) => {
    const position = frame.toolPosition;
    for (let index = segmentCursor; index < records.length - 1; index += 1) {
      const start = records[index];
      const end = records[index + 1];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const dz = end.z - start.z;
      const segmentLengthSq = dx * dx + dy * dy + dz * dz;
      if (segmentLengthSq <= positionToleranceSq) {
        continue;
      }

      const parameter = (
        (position.x - start.x) * dx +
        (position.y - start.y) * dy +
        (position.z - start.z) * dz
      ) / segmentLengthSq;
      if (parameter < -positionTolerance || parameter > 1 + positionTolerance) {
        continue;
      }

      const clampedParameter = Math.max(0, Math.min(parameter, 1));
      const projectedX = start.x + dx * clampedParameter;
      const projectedY = start.y + dy * clampedParameter;
      const projectedZ = start.z + dz * clampedParameter;
      const projectionDistanceSq =
        (position.x - projectedX) ** 2 +
        (position.y - projectedY) ** 2 +
        (position.z - projectedZ) ** 2;
      if (projectionDistanceSq > positionToleranceSq) {
        continue;
      }

      segmentCursor = index;
      template = end;
      break;
    }

    return {
      ...template,
      x: position.x,
      y: position.y,
      z: position.z,
    };
  });
}

type PendingSimulationPresentation = {
  simulationId: string;
  frameIndex: number;
  frame: SimulationDisplayFrame;
  activeMeshUrl: string;
  cachedMeshUrl: string;
  waitingForSecondaryUrl: string | null;
  waitingForTertiaryUrl: string | null;
  secondaryElapsedMs: number | null;
  tertiaryElapsedMs: number | null;
  shouldApply: () => boolean;
  resolve: (applied: boolean) => void;
};

type MeshCacheState = "idle" | "saving" | "ready" | "error";

type CachedMeshResponse = {
  name: string;
  meshUrl: string;
  maxZ: number;
  version: string;
};

type LocalCachedMeshPayload = {
  name: string;
  dataUrl: string;
  maxZ?: number | null;
};

type SidebarSettingsPayload = {
  selectedOperationId: string | null;
  selectedTreeNodeId?: string;
  operations: Operation[];
};

const SIDEBAR_SETTINGS_STORAGE_KEY = "opencam.sidebar-settings.v3";
const LOCAL_MESH_STORAGE_KEY = "opencam.step.v1";
const ORIGINAL_MESH_COLOR = 0x94a3b8;
const ORIGINAL_MESH_EDGE_COLOR = 0x334155;
const MILLED_STOCK_MESH_COLOR = 0xfb923c;
const ACTIVE_DEBUG_MESH_COLOR = 0xf97316;
const DEBUG_REST_MESH_COLOR = 0xf97316;
const CURRENT_CHUNK_PATH_COLOR = "#a855f7";
const CHUNK_START_MARKER_COLOR = "#22c55e";
const CHUNK_END_MARKER_COLOR = "#ef4444";
const CHUNK_MARKER_SIZE = 2;
const SIMULATION_PLAYBACK_INTERVAL_MS = 30;
const SIMULATION_CONTACT_STEP_DISTANCE = 0.5;
const SIMULATION_RAPID_FRAME_STEP_SCALE = 4;
const CHUNK_PADDING_X = 5;
const CHUNK_PADDING_Y = 5;
const CHUNK_PADDING_Z = 1;

function isSidebarSettingsPayload(value: unknown): value is SidebarSettingsPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    (payload.selectedOperationId === null || typeof payload.selectedOperationId === "string") &&
    Array.isArray(payload.operations)
  );
}

function resolveBackendAssetUrl(url: string) {
  if (/^(?:[a-z]+:)?\/\//i.test(url) || url.startsWith("blob:") || url.startsWith("data:")) {
    return url;
  }

  if (url.startsWith("/")) {
    return `${getBackendUrl()}${url}`;
  }

  return `${getBackendUrl()}/${url}`;
}

async function prefetchMeshObjectUrl(url: string, cache: RequestCache = "default") {
  const response = await fetch(resolveBackendAssetUrl(url), { cache });

  if (!response.ok) {
    throw new Error(`Failed to load mesh (${response.status}).`);
  }

  const meshBlob = await response.blob();
  return URL.createObjectURL(meshBlob);
}

async function prefetchMeshObjectUrlWithTiming(url: string, cache: RequestCache = "default") {
  const startedAt = performance.now();
  const objectUrl = await prefetchMeshObjectUrl(url, cache);
  return {
    objectUrl,
    elapsedMs: performance.now() - startedAt,
  };
}

async function readCachedMeshResponse(response: Response, fallbackMessage: string) {
  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail ?? fallbackMessage);
    }

    const detail = await response.text();
    throw new Error(detail || fallbackMessage);
  }

  return (await response.json()) as CachedMeshResponse;
}

async function fetchCachedMesh(): Promise<CachedMeshResponse | null> {
  const response = await fetch(`${getBackendUrl()}/cam/mesh`);

  if (response.status === 404) {
    return null;
  }

  return readCachedMeshResponse(response, "Failed to load cached mesh.");
}

function isLocalCachedMeshPayload(value: unknown): value is LocalCachedMeshPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;
  return (
    typeof payload.name === "string" &&
    typeof payload.dataUrl === "string" &&
    payload.dataUrl.startsWith("data:") &&
    (payload.maxZ == null || (typeof payload.maxZ === "number" && Number.isFinite(payload.maxZ)))
  );
}

function removeCachedMeshFromLocalStorage() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage.removeItem(LOCAL_MESH_STORAGE_KEY);
  } catch {
    // Ignore unavailable localStorage.
  }
}

function readCachedMeshFromLocalStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const cachedMesh = window.localStorage.getItem(LOCAL_MESH_STORAGE_KEY);
    if (!cachedMesh) {
      return null;
    }

    const parsed = JSON.parse(cachedMesh) as unknown;
    if (isLocalCachedMeshPayload(parsed)) {
      return parsed;
    }
  } catch (error: unknown) {
    console.error("Failed to read cached STEP from localStorage", error);
  }

  removeCachedMeshFromLocalStorage();
  return null;
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read STEP for browser cache."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read STEP for browser cache."));
    reader.readAsDataURL(file);
  });
}

async function saveMeshToLocalStorage(file: File, shouldSave: () => boolean = () => true) {
  const dataUrl = await readFileAsDataUrl(file);
  const payload = {
    name: file.name,
    dataUrl,
  } satisfies LocalCachedMeshPayload;

  if (typeof window === "undefined" || !shouldSave()) {
    return { payload, saved: false };
  }

  try {
    // ponytail: localStorage only fits small STEP files; use IndexedDB if large files need browser persistence.
    window.localStorage.setItem(LOCAL_MESH_STORAGE_KEY, JSON.stringify(payload));
    return { payload, saved: true };
  } catch (error: unknown) {
    console.error("Failed to cache STEP in localStorage", error);
    removeCachedMeshFromLocalStorage();
    return { payload, saved: false };
  }
}

async function uploadStepToBackend(step: Blob, name: string, signal?: AbortSignal) {
  const upload = new FormData();
  upload.append("step", step, name);

  const response = await fetch(`${getBackendUrl()}/cam/mesh`, {
    method: "POST",
    body: upload,
    signal,
  });

  return readCachedMeshResponse(response, "Failed to process STEP in backend.");
}

async function uploadLocalStorageMeshToBackend(cachedMesh: LocalCachedMeshPayload, signal?: AbortSignal) {
  const stepResponse = await fetch(cachedMesh.dataUrl, { signal });
  const stepBlob = await stepResponse.blob();
  return uploadStepToBackend(stepBlob, cachedMesh.name, signal);
}

function toolPositionToPoint(position: ToolPositionResponse): PolylinePoint {
  return [position.x, position.y, position.z] as const;
}

function createPointMarkerPolylines(id: string, name: string, point: PolylinePoint, color: string): PolylineDefinition[] {
  const [x, y, z] = point;
  return [
    {
      id: `${id}-x`,
      name,
      color,
      points: [[x - CHUNK_MARKER_SIZE, y, z], [x + CHUNK_MARKER_SIZE, y, z]],
    },
    {
      id: `${id}-y`,
      name,
      color,
      points: [[x, y - CHUNK_MARKER_SIZE, z], [x, y + CHUNK_MARKER_SIZE, z]],
    },
  ];
}

type ClosedPolyline = ClosedPolyline2D | ClosedPolyline25D;

function geometryToMeshFaceSelection(geometry: ClosedPolyline, index: number, fallbackZ: number): MeshFaceSelection {
  const z = "z" in geometry ? geometry.z : fallbackZ;
  return {
    id: `geometry-${index}`,
    label: `Edge loop ${index + 1}`,
    normal: [0, 0, 1],
    triangleIndices: [],
    triangleCount: 0,
    area: 0,
    isParallelToXY: true,
    planeZ: z,
    boundaryLoop: geometry.vertices.map(({ x, y }) => [x, y, z] as const),
    validationError: null,
  };
}

function operationToMeshFaceSelections(operation: Operation | null, fallbackZ: number): MeshFaceSelection[] {
  if (!operation) {
    return [];
  }
  const geometries = operation.driveGeometry as unknown as ClosedPolyline[];
  return geometries.map((geometry, index) =>
    geometryToMeshFaceSelection(geometry, index, fallbackZ),
  );
}

function draftToMeshFaceSelections(draft: DraftObject | null, fallbackZ: number): MeshFaceSelection[] {
  const geometries = Array.isArray(draft?.driveGeometry) ? draft.driveGeometry : [];

  return geometries.flatMap((geometry, index) => {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
      return [];
    }

    const geometryZ = Number((geometry as DraftObject).z);
    const z = Number.isFinite(geometryZ) ? geometryZ : fallbackZ;
    const vertices = (geometry as DraftObject).vertices;
    if (!Array.isArray(vertices)) {
      return [];
    }

    const parsedVertices = vertices.flatMap((vertex) => {
      if (!vertex || typeof vertex !== "object" || Array.isArray(vertex)) {
        return [];
      }

      const x = Number((vertex as DraftObject).x);
      const y = Number((vertex as DraftObject).y);
      return Number.isFinite(x) && Number.isFinite(y) ? [{ x, y }] : [];
    });

    if (parsedVertices.length === 0) {
      return [];
    }

    return [geometryToMeshFaceSelection({ z, vertices: parsedVertices as ClosedPolyline25D["vertices"] }, index, fallbackZ)];
  });
}

function buildSimulationDisplayFrames(
  simulationId: string,
  chunks: ReadonlyArray<SimulationChunkResponse>,
): SimulationDisplayFrame[] {
  let sourceFrameIndex = 0;
  return chunks.flatMap((chunk, chunkIndex) =>
    chunk.frames.map((frame) => ({
      activeMeshUrl: `/simulate/${simulationId}/chunks/${chunkIndex}/active-meshes/${frame.activeMeshIndex}.glb`,
      activeMeshKey: `${chunkIndex}:${frame.activeMeshIndex}`,
      cachedMeshUrl: chunk.cachedMeshUrl,
      chunkIndex,
      sourceFrameIndex: sourceFrameIndex++,
      toolPosition: frame.toolPosition,
      clRecordIndex: frame.clRecordIndex,
    })),
  );
}

function strideSimulationFrames(
  frames: ReadonlyArray<SimulationDisplayFrame>,
  stride: number,
) {
  if (frames.length === 0) {
    return [];
  }

  const strided = frames.filter((_, index) => index % stride === 0);
  if ((frames.length - 1) % stride !== 0) {
    strided.push(frames[frames.length - 1]);
  }
  return strided;
}

function simulationStrideFrameCount(totalFrameCount: number, stride: number) {
  if (totalFrameCount <= 0) {
    return 0;
  }

  const baseCount = Math.floor((totalFrameCount - 1) / stride) + 1;
  return (totalFrameCount - 1) % stride === 0 ? baseCount : baseCount + 1;
}

function App() {
  const {
    meshUrl,
    meshMaxZ,
    cachedMeshVersion,
    operations,
    generatedOperationsById,
    faceSelectionMode,
    selectedMeshFace,
    selectedOperationId,
    selectedTreeNodeId,
    isOperationTypeDialogOpen,
    isOperationDialogOpen,
    operationDialogMode,
    resumeOperationDialogAfterSelection,
    operationDraft,
    isSimulationMode,
    isComparisonMode,
    showStock,
    showPartMesh,
    showToolpaths,
    showTool,
    simulationId,
    simulationFrameCount,
    simulationFrameIndex,
    simulationStride,
    displayedSimulationFrameIndex,
    isSimulationPlaying,
  } = useCamStore(useShallow((state) => ({
    meshUrl: state.workspace.meshUrl,
    meshMaxZ: state.workspace.meshMaxZ,
    cachedMeshVersion: state.workspace.cachedMeshVersion,
    operations: state.workspace.operations,
    generatedOperationsById: state.workspace.generatedOperationsById,
    faceSelectionMode: state.selection.faceSelectionMode,
    selectedMeshFace: state.selection.selectedMeshFace,
    selectedOperationId: state.selection.selectedOperationId,
    selectedTreeNodeId: state.selection.selectedTreeNodeId,
    isOperationTypeDialogOpen: state.dialogs.isOperationTypeDialogOpen,
    isOperationDialogOpen: state.dialogs.isOperationDialogOpen,
    operationDialogMode: state.dialogs.operationDialogMode,
    resumeOperationDialogAfterSelection: state.dialogs.resumeOperationDialogAfterSelection,
    operationDraft: state.dialogs.operationDraft,
    isSimulationMode: state.viewport.isSimulationMode,
    isComparisonMode: state.viewport.isComparisonMode,
    showStock: state.viewport.showStock,
    showPartMesh: state.viewport.showPartMesh,
    showToolpaths: state.viewport.showToolpaths,
    showTool: state.viewport.showTool,
    simulationId: state.simulation.id,
    simulationFrameCount: state.simulation.frameCount,
    simulationFrameIndex: state.simulation.frameIndex,
    simulationStride: state.simulation.stride,
    displayedSimulationFrameIndex: state.simulation.displayedFrameIndex,
    isSimulationPlaying: state.simulation.isPlaying,
  })));
  const setMeshName = useCamStore((state) => state.actions.setMeshName);
  const setMeshUrl = useCamStore((state) => state.actions.setMeshUrl);
  const setMeshMaxZ = useCamStore((state) => state.actions.setMeshMaxZ);
  const setCachedMeshVersion = useCamStore((state) => state.actions.setCachedMeshVersion);
  const setOperations = useCamStore((state) => state.actions.setOperations);
  const setGeneratedOperationsById = useCamStore((state) => state.actions.setGeneratedOperationsById);
  const setSelectedMeshFace = useCamStore((state) => state.actions.setSelectedMeshFace);
  const setFaceSelectionMode = useCamStore((state) => state.actions.setFaceSelectionMode);
  const setSelectedOperationId = useCamStore((state) => state.actions.setSelectedOperationId);
  const setSelectedTreeNodeId = useCamStore((state) => state.actions.setSelectedTreeNodeId);
  const setIsOperationTypeDialogOpen = useCamStore((state) => state.actions.setIsOperationTypeDialogOpen);
  const setIsOperationDialogOpen = useCamStore((state) => state.actions.setIsOperationDialogOpen);
  const setOperationDialogMode = useCamStore((state) => state.actions.setOperationDialogMode);
  const setResumeOperationDialogAfterSelection = useCamStore((state) => state.actions.setResumeOperationDialogAfterSelection);
  const setOperationDraft = useCamStore((state) => state.actions.setOperationDraft);
  const setIsSimulationMode = useCamStore((state) => state.actions.setIsSimulationMode);
  const setIsComparisonMode = useCamStore((state) => state.actions.setIsComparisonMode);
  const setShowStock = useCamStore((state) => state.actions.setShowStock);
  const setSimulationId = useCamStore((state) => state.actions.setSimulationId);
  const setSimulationFrameCount = useCamStore((state) => state.actions.setSimulationFrameCount);
  const setSimulationFrameIndex = useCamStore((state) => state.actions.setSimulationFrameIndex);
  const setSimulationStride = useCamStore((state) => state.actions.setSimulationStride);
  const setDisplayedSimulationFrameIndex = useCamStore((state) => state.actions.setDisplayedSimulationFrameIndex);
  const setIsSimulationPlaying = useCamStore((state) => state.actions.setIsSimulationPlaying);

  const {
    simulationDebugUiEnabled,
    simulationCompletedToolpathOnly,
    toolRenderMode,
    partRenderMode,
    stockRenderMode,
    clearanceOffset,
  } = useSettingsStore();
  const [, setMeshCacheState] = useState<MeshCacheState>("idle");
  const [, setMeshCacheMessage] = useState<string>("");
  const meshUploadRequestRef = useRef(0);
  const meshRestoreAbortRef = useRef<AbortController | null>(null);
  const hasInitializedSidebarSettingsRef = useRef(false);

  const [generatedOperation, setGeneratedOperation] =
    useState<GeneratedOperationResponse | null>(null);

  const [simulationActiveMeshUrl, setSimulationActiveMeshUrl] = useState<string | null>(null);
  const [simulationCachedMeshUrl, setSimulationCachedMeshUrl] = useState<string | null>(null);
  const [simulationFinalMeshUrl, setSimulationFinalMeshUrl] = useState<string | null>(null);
  const [simulationToolMeshUrl, setSimulationToolMeshUrl] = useState<string | null>(null);
  const [simulationToolPosition, setSimulationToolPosition] = useState<PolylinePoint | null>(null);
  const [simulationOperationId, setSimulationOperationId] = useState<string | null>(null);
  const [simulationTaskId, setSimulationTaskId] = useState<string | null>(null);
  const [generatingOperationId, setGeneratingOperationId] = useState<string | null>(null);
  const [simulationProgressPercent, setSimulationProgressPercent] = useState(0);
  const [simulationChunkCount, setSimulationChunkCount] = useState(0);
  const [simulationChunkIndex, setSimulationChunkIndex] = useState<number | null>(null);
  const [simulationChunkStepIndex, setSimulationChunkStepIndex] = useState<number | null>(null);
  const [simulationChunkStepCount, setSimulationChunkStepCount] = useState(0);
  const [simulationFocusMeshRequestMs, setSimulationFocusMeshRequestMs] = useState<number | null>(null);
  const [simulationChunkFetchMs, setSimulationChunkFetchMs] = useState<number | null>(null);
  const [simulationChunkToolpathPoints, setSimulationChunkToolpathPoints] = useState<PolylinePoint[]>([]);
  const [simulationDisplayFrames, setSimulationDisplayFrames] = useState<SimulationDisplayFrame[]>([]);
  const loadedSimulationFrameRef = useRef<{
    simulationId: string | null;
    frameIndex: number | null;
  }>({
    simulationId: null,
    frameIndex: null,
  });
  const simulationFrameDisplayRequestRef = useRef(0);
  const queuedGenerationOperationsRef = useRef<Operation[]>([]);
  const currentGenerationLabelRef = useRef("2D Pocket");
  const simulationActiveMeshUrlRef = useRef<string | null>(null);
  const simulationCachedMeshUrlRef = useRef<string | null>(null);
  const displayedSimulationActiveMeshKeyRef = useRef<string | null>(null);
  const displayedSimulationActiveMeshUrlRef = useRef<string | null>(null);
  const displayedSimulationChunkIndexRef = useRef<number | null>(null);
  const displayedSimulationCachedMeshUrlRef = useRef<string | null>(null);
  const pendingSimulationPresentationRef = useRef<PendingSimulationPresentation | null>(null);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [requestMessage, setRequestMessage] = useState<string>("");
  const [comparisonCachedMeshUrl, setComparisonCachedMeshUrl] = useState<string | null>(null);
  const [comparisonActiveMeshUrl, setComparisonActiveMeshUrl] = useState<string | null>(null);
  const comparisonRequestRef = useRef(0);
  const comparisonObjectUrlsRef = useRef<string[]>([]);


  const updateSimulationActiveMeshUrl = useCallback((url: string | null) => {
    simulationActiveMeshUrlRef.current = url;
    setSimulationActiveMeshUrl(url);
  }, []);

  const updateSimulationCachedMeshUrl = useCallback((url: string | null) => {
    simulationCachedMeshUrlRef.current = url;
    setSimulationCachedMeshUrl(url);
  }, []);
  useEffect(() => {
    sendRhinoUiDebug("info", "App mounted", {
      bootstrap: getOpenCamBootstrap(),
      backendUrl: getBackendUrl(),
    });
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      hasInitializedSidebarSettingsRef.current = true;
      return;
    }

    try {
      const cachedSettings = window.localStorage.getItem(SIDEBAR_SETTINGS_STORAGE_KEY);
      if (!cachedSettings) {
        return;
      }

      const parsed = JSON.parse(cachedSettings) as unknown;
      if (!isSidebarSettingsPayload(parsed)) {
        throw new Error("Invalid cached sidebar settings payload.");
      }

      setSelectedOperationId(parsed.selectedOperationId);
      setSelectedTreeNodeId(parsed.selectedTreeNodeId ?? parsed.selectedOperationId ?? "setup-1");
      setOperations(parsed.operations);
    } catch {
      window.localStorage.removeItem(SIDEBAR_SETTINGS_STORAGE_KEY);
    } finally {
      hasInitializedSidebarSettingsRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!hasInitializedSidebarSettingsRef.current || typeof window === "undefined") {
      return;
    }

    const payload: SidebarSettingsPayload = {
      selectedOperationId,
      selectedTreeNodeId,
      operations,
    };

    try {
      window.localStorage.setItem(
        SIDEBAR_SETTINGS_STORAGE_KEY,
        JSON.stringify(payload),
      );
    } catch (error: unknown) {
      console.error("Failed to persist sidebar settings", error);
    }
  }, [operations, selectedOperationId, selectedTreeNodeId]);

  useEffect(() => {
    let cancelled = false;
    let restoreController: AbortController | null = null;
    const requestId = meshUploadRequestRef.current + 1;
    meshUploadRequestRef.current = requestId;

    void (async () => {
      const localMesh = readCachedMeshFromLocalStorage();
      if (localMesh) {
        if (cancelled || meshUploadRequestRef.current !== requestId) {
          return;
        }

        setMeshName(localMesh.name);
        setMeshUrl(null);
        setMeshMaxZ(null);
        setMeshCacheState("saving");
        setMeshCacheMessage("Restoring STEP in backend memory...");

        restoreController = new AbortController();
        meshRestoreAbortRef.current = restoreController;
        try {
          const restoredMesh = await uploadLocalStorageMeshToBackend(localMesh, restoreController.signal);
          if (!cancelled && meshUploadRequestRef.current === requestId) {
            setMeshUrl(resolveBackendAssetUrl(restoredMesh.meshUrl));
            setMeshMaxZ(restoredMesh.maxZ);
            setCachedMeshVersion(restoredMesh.version);
            setMeshCacheState("ready");
            setMeshCacheMessage("STEP and mesh cached in backend memory.");
          }
        } catch (error: unknown) {
          if (!cancelled && meshUploadRequestRef.current === requestId) {
            console.error("Failed to restore STEP to backend cache", error);
            setMeshCacheMessage("Cached in browser localStorage. Backend cache unavailable.");
          }
        } finally {
          if (meshRestoreAbortRef.current === restoreController) {
            meshRestoreAbortRef.current = null;
          }
        }
        return;
      }

      const cachedMesh = await fetchCachedMesh();
      if (cancelled || meshUploadRequestRef.current !== requestId || !cachedMesh) {
        return;
      }

      setMeshName(cachedMesh.name);
      setMeshUrl(resolveBackendAssetUrl(cachedMesh.meshUrl));
      setMeshMaxZ(cachedMesh.maxZ);
      setCachedMeshVersion(cachedMesh.version);
      setMeshCacheState("ready");
      setMeshCacheMessage("Cached in backend memory.");
    })().catch((error: unknown) => {
      if (cancelled || meshUploadRequestRef.current !== requestId) {
        return;
      }

      console.error("Failed to restore cached mesh", error);
      setMeshCacheState("error");
      setMeshCacheMessage(
        error instanceof Error ? error.message : "Unable to restore the cached STEP.",
      );
    });

    return () => {
      cancelled = true;
      restoreController?.abort();
      if (meshRestoreAbortRef.current === restoreController) {
        meshRestoreAbortRef.current = null;
      }
    };
  }, []);

  function resetSimulationPlaybackState() {
    resetComparisonPreview();
    resolvePendingSimulationPresentation(false);
    loadedSimulationFrameRef.current = {
      simulationId: null,
      frameIndex: null,
    };
    simulationFrameDisplayRequestRef.current += 1;
    if (simulationActiveMeshUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(simulationActiveMeshUrlRef.current);
    }
    if (simulationCachedMeshUrlRef.current?.startsWith("blob:")) {
      URL.revokeObjectURL(simulationCachedMeshUrlRef.current);
    }
    displayedSimulationActiveMeshKeyRef.current = null;
    displayedSimulationActiveMeshUrlRef.current = null;
    displayedSimulationChunkIndexRef.current = null;
    displayedSimulationCachedMeshUrlRef.current = null;
    updateSimulationActiveMeshUrl(null);
    updateSimulationCachedMeshUrl(null);
    setSimulationFinalMeshUrl(null);
    setSimulationToolMeshUrl(null);
    setSimulationToolPosition(null);
    setSimulationId(null);
    setSimulationOperationId(null);
    setSimulationTaskId(null);
    setSimulationProgressPercent(0);
    setSimulationFrameCount(0);
    setSimulationChunkCount(0);
    setSimulationChunkIndex(null);
    setSimulationChunkStepIndex(null);
    setSimulationChunkStepCount(0);
    setSimulationFocusMeshRequestMs(null);
    setSimulationChunkFetchMs(null);
    setSimulationChunkToolpathPoints([]);
    setSimulationDisplayFrames([]);
    setSimulationFrameIndex(0);
    setDisplayedSimulationFrameIndex(null);
    setIsSimulationPlaying(false);
  }

  function resetComparisonPreview() {
    comparisonRequestRef.current += 1;
    comparisonObjectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    comparisonObjectUrlsRef.current = [];
    setComparisonCachedMeshUrl(null);
    setComparisonActiveMeshUrl(null);
    setIsComparisonMode(false);
  }

  const visibleOperations = useMemo(() => {
    if (selectedTreeNodeId === "setup-1") {
      return operations;
    }

    return operations.filter((operation) => operation.id === selectedTreeNodeId);
  }, [operations, selectedTreeNodeId]);

  const generatedRecords = useMemo<PositionRecord3D[]>(
    () => visibleOperations.flatMap((operation) => operation.id ? (generatedOperationsById[operation.id]?.records ?? []) : []),
    [generatedOperationsById, visibleOperations],
  );
  const simulationSamples = useMemo(
    () => sampleOperationRecords(
      generatedRecords,
      SIMULATION_CONTACT_STEP_DISTANCE,
      SIMULATION_RAPID_FRAME_STEP_SCALE,
    ),
    [generatedRecords],
  );
  const visibleSimulationFrames = useMemo(
    () => strideSimulationFrames(simulationDisplayFrames, simulationStride),
    [simulationDisplayFrames, simulationStride],
  );
  const hasCompletedSimulationStock = Boolean(simulationFinalMeshUrl);
  const secondaryMeshUrl = isSimulationMode
    ? simulationCachedMeshUrl
    : isComparisonMode ? comparisonCachedMeshUrl : hasCompletedSimulationStock ? simulationFinalMeshUrl : null;
  const tertiaryMeshUrl = isSimulationMode
    ? simulationActiveMeshUrl
    : isComparisonMode ? comparisonActiveMeshUrl : null;
  const simulationDebugDisplayActive = simulationDebugUiEnabled && isSimulationMode && Boolean(simulationCachedMeshUrl);
  const stockMeshColor = simulationDebugDisplayActive ? DEBUG_REST_MESH_COLOR : MILLED_STOCK_MESH_COLOR;
  const activeMeshColor = simulationDebugDisplayActive ? MILLED_STOCK_MESH_COLOR : ACTIVE_DEBUG_MESH_COLOR;

  const operationPolylines = useMemo<PolylineDefinition[]>(() => {
    return createDisplayPolylines(generatedRecords);
  }, [generatedRecords]);

  const otherOperationRecords = useMemo<PositionRecord3D[]>(() => {
    return visibleOperations.flatMap((operation) =>
      operation.id && operation.id !== simulationOperationId
        ? (generatedOperationsById[operation.id]?.records ?? [])
        : [],
    );
  }, [generatedOperationsById, visibleOperations, simulationOperationId]);

  const otherOperationPolylines = useMemo<PolylineDefinition[]>(() => {
    return createDisplayPolylines(otherOperationRecords);
  }, [otherOperationRecords]);

  const simulationClippingEligible = Boolean(
    isSimulationMode &&
      simulationCompletedToolpathOnly &&
      simulationOperationId &&
      (generatedOperationsById[simulationOperationId]?.records?.length ?? 0) >= 2,
  );

  const simulationFrameRecords = useMemo<PositionRecord3D[] | null>(() => {
    if (!simulationClippingEligible || !simulationOperationId) {
      return null;
    }
    const operationRecords = generatedOperationsById[simulationOperationId]?.records;
    if (!operationRecords) {
      return null;
    }
    return createSimulationFrameRecords(operationRecords, simulationDisplayFrames);
  }, [generatedOperationsById, simulationClippingEligible, simulationDisplayFrames, simulationOperationId]);

  const simulationCompletedPolylines = useMemo<PolylineDefinition[] | null>(() => {
    if (!simulationFrameRecords) {
      return simulationClippingEligible ? [] : null;
    }
    if (displayedSimulationFrameIndex == null) {
      return [];
    }
    const displayedFrame = visibleSimulationFrames[displayedSimulationFrameIndex];
    if (!displayedFrame) {
      return [];
    }
    return createDisplayPolylines(
      simulationFrameRecords.slice(0, displayedFrame.sourceFrameIndex + 1),
    );
  }, [
    displayedSimulationFrameIndex,
    simulationClippingEligible,
    simulationFrameRecords,
    visibleSimulationFrames,
  ]);

  const viewportPolylines = useMemo<PolylineDefinition[]>(() => {
    const clippingActive = simulationCompletedPolylines !== null;
    const basePolylines = clippingActive
      ? [...otherOperationPolylines, ...simulationCompletedPolylines]
      : operationPolylines;

    if (!simulationDebugUiEnabled || !isSimulationMode || simulationChunkToolpathPoints.length < 2) {
      return basePolylines;
    }

    const startPoint = simulationChunkToolpathPoints[0];
    const endPoint = simulationChunkToolpathPoints[simulationChunkToolpathPoints.length - 1];
    return [
      ...basePolylines,
      {
        id: "simulation-current-chunk-toolpath",
        name: "Current chunk toolpath",
        color: CURRENT_CHUNK_PATH_COLOR,
        kind: "feed_rate",
        points: simulationChunkToolpathPoints,
      },
      ...createPointMarkerPolylines("simulation-current-chunk-start", "Chunk start", startPoint, CHUNK_START_MARKER_COLOR),
      ...createPointMarkerPolylines("simulation-current-chunk-end", "Chunk end", endPoint, CHUNK_END_MARKER_COLOR),
    ];
  }, [
    isSimulationMode,
    operationPolylines,
    otherOperationPolylines,
    simulationCompletedPolylines,
    simulationChunkToolpathPoints,
    simulationDebugUiEnabled,
  ]);

  useEffect(() => {
    const nextFrameCount = visibleSimulationFrames.length;
    setSimulationFrameCount(nextFrameCount);
    setSimulationFrameIndex((current) => Math.min(current, Math.max(nextFrameCount - 1, 0)));
  }, [visibleSimulationFrames.length]);

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  );
  const simulatableOperationIds = useMemo(
    () => simulationId && simulationOperationId ? new Set([simulationOperationId]) : new Set<string>(),
    [simulationId, simulationOperationId],
  );
  const comparableOperationIds = useMemo(
    () => simulationId && simulationOperationId ? new Set([simulationOperationId]) : new Set<string>(),
    [simulationId, simulationOperationId],
  );
  const downloadableOperationIds = useMemo(
    () => new Set(Object.keys(generatedOperationsById)),
    [generatedOperationsById],
  );

  const highlightedMeshFaces = useMemo(() => {
    if (isOperationDialogOpen || faceSelectionMode) {
      return draftToMeshFaceSelections(operationDraft, meshMaxZ ?? 0);
    }

    return visibleOperations.flatMap((operation) => operationToMeshFaceSelections(operation, meshMaxZ ?? 0));
  }, [faceSelectionMode, isOperationDialogOpen, meshMaxZ, operationDraft, visibleOperations]);

  const resolvePendingSimulationPresentation = useCallback((applied: boolean) => {
    const pending = pendingSimulationPresentationRef.current;
    if (!pending) {
      return;
    }

    pendingSimulationPresentationRef.current = null;
    if (!applied) {
      if (simulationActiveMeshUrlRef.current !== displayedSimulationActiveMeshUrlRef.current) {
        updateSimulationActiveMeshUrl(displayedSimulationActiveMeshUrlRef.current);
      }
      if (simulationCachedMeshUrlRef.current !== displayedSimulationCachedMeshUrlRef.current) {
        updateSimulationCachedMeshUrl(displayedSimulationCachedMeshUrlRef.current);
      }
    }
    pending.resolve(applied);
  }, [updateSimulationActiveMeshUrl, updateSimulationCachedMeshUrl]);

  const commitSimulationFramePresentation = useCallback(
    (
      nextSimulationId: string,
      frameIndex: number,
      frame: SimulationDisplayFrame,
      activeMeshUrl: string,
      cachedMeshUrl: string,
      tertiaryElapsedMs: number,
      secondaryElapsedMs: number,
    ) => {
      loadedSimulationFrameRef.current = {
        simulationId: nextSimulationId,
        frameIndex,
      };
      displayedSimulationActiveMeshKeyRef.current = frame.activeMeshKey;
      displayedSimulationActiveMeshUrlRef.current = activeMeshUrl;
      displayedSimulationChunkIndexRef.current = frame.chunkIndex;
      displayedSimulationCachedMeshUrlRef.current = cachedMeshUrl;
      setDisplayedSimulationFrameIndex(frameIndex);
      setSimulationFrameIndex(frameIndex);
      setSimulationChunkIndex(frame.chunkIndex);
      setSimulationChunkStepIndex(null);
      setSimulationChunkStepCount(0);
      setSimulationFocusMeshRequestMs(tertiaryElapsedMs);
      setSimulationChunkFetchMs(secondaryElapsedMs);
      setSimulationChunkToolpathPoints([]);
      setSimulationToolPosition(toolPositionToPoint(frame.toolPosition));
    },
    [setSimulationFrameIndex],
  );

  const maybeCommitPendingSimulationPresentation = useCallback(() => {
    const pending = pendingSimulationPresentationRef.current;
    if (!pending) {
      return;
    }

    if (pending.waitingForSecondaryUrl || pending.waitingForTertiaryUrl) {
      return;
    }

    if (!pending.shouldApply()) {
      resolvePendingSimulationPresentation(false);
      return;
    }

    commitSimulationFramePresentation(
      pending.simulationId,
      pending.frameIndex,
      pending.frame,
      pending.activeMeshUrl,
      pending.cachedMeshUrl,
      pending.tertiaryElapsedMs ?? 0,
      pending.secondaryElapsedMs ?? 0,
    );
    resolvePendingSimulationPresentation(true);
  }, [commitSimulationFramePresentation, resolvePendingSimulationPresentation]);

  const handleSecondaryMeshDisplayed = useCallback(
    (meshUrl: string, elapsedMs: number) => {
      const pending = pendingSimulationPresentationRef.current;
      if (!pending || pending.waitingForSecondaryUrl !== meshUrl) {
        return;
      }

      pending.waitingForSecondaryUrl = null;
      pending.secondaryElapsedMs = elapsedMs;
      maybeCommitPendingSimulationPresentation();
    },
    [maybeCommitPendingSimulationPresentation],
  );

  const handleTertiaryMeshDisplayed = useCallback(
    (meshUrl: string, elapsedMs: number) => {
      const pending = pendingSimulationPresentationRef.current;
      if (!pending || pending.waitingForTertiaryUrl !== meshUrl) {
        return;
      }

      pending.waitingForTertiaryUrl = null;
      pending.tertiaryElapsedMs = elapsedMs;
      maybeCommitPendingSimulationPresentation();
    },
    [maybeCommitPendingSimulationPresentation],
  );

  const applySimulationFrame = useCallback(
    async (
      nextSimulationId: string,
      frameIndex: number,
      frame: SimulationDisplayFrame,
      shouldApply: () => boolean = () => true,
    ) => {
      resolvePendingSimulationPresentation(false);

      const activeMeshUrl = frame.activeMeshKey === displayedSimulationActiveMeshKeyRef.current
        && displayedSimulationActiveMeshUrlRef.current
        ? displayedSimulationActiveMeshUrlRef.current
        : resolveBackendAssetUrl(frame.activeMeshUrl);
      const cachedMeshUrl = frame.chunkIndex === displayedSimulationChunkIndexRef.current
        && displayedSimulationCachedMeshUrlRef.current
        ? displayedSimulationCachedMeshUrlRef.current
        : resolveBackendAssetUrl(frame.cachedMeshUrl);
      const needsActiveMeshDisplay = displayedSimulationActiveMeshKeyRef.current !== frame.activeMeshKey
        || displayedSimulationActiveMeshUrlRef.current == null;
      const needsCachedMeshDisplay = displayedSimulationChunkIndexRef.current !== frame.chunkIndex
        || displayedSimulationCachedMeshUrlRef.current == null;

      if (!shouldApply()) {
        return false;
      }

      if (simulationActiveMeshUrlRef.current !== activeMeshUrl) {
        updateSimulationActiveMeshUrl(activeMeshUrl);
      }
      if (simulationCachedMeshUrlRef.current !== cachedMeshUrl) {
        updateSimulationCachedMeshUrl(cachedMeshUrl);
      }

      if (!needsActiveMeshDisplay && !needsCachedMeshDisplay) {
        commitSimulationFramePresentation(
          nextSimulationId,
          frameIndex,
          frame,
          activeMeshUrl,
          cachedMeshUrl,
          0,
          0,
        );
        return true;
      }

      return await new Promise<boolean>((resolve) => {
        pendingSimulationPresentationRef.current = {
          simulationId: nextSimulationId,
          frameIndex,
          frame,
          activeMeshUrl,
          cachedMeshUrl,
          waitingForSecondaryUrl: needsCachedMeshDisplay ? cachedMeshUrl : null,
          waitingForTertiaryUrl: needsActiveMeshDisplay ? activeMeshUrl : null,
          secondaryElapsedMs: needsCachedMeshDisplay ? null : 0,
          tertiaryElapsedMs: needsActiveMeshDisplay ? null : 0,
          shouldApply,
          resolve,
        };
        maybeCommitPendingSimulationPresentation();
      });
    },
    [
      commitSimulationFramePresentation,
      maybeCommitPendingSimulationPresentation,
      resolvePendingSimulationPresentation,
      updateSimulationActiveMeshUrl,
      updateSimulationCachedMeshUrl,
    ],
  );

  const applyCompletedSimulation = useCallback(
    async (simulation: SweptSimulationResponse, nextIsSimulationMode = false) => {
      const nextDisplayFrames = buildSimulationDisplayFrames(simulation.simulationId, simulation.chunks);
      const nextVisibleFrames = strideSimulationFrames(nextDisplayFrames, simulationStride);
      const finalFrameIndex = Math.max(nextVisibleFrames.length - 1, 0);
      const finalFrame = nextVisibleFrames[finalFrameIndex] ?? null;

      setSimulationDisplayFrames(nextDisplayFrames);
      setSimulationId(simulation.simulationId);
      setSimulationFrameCount(nextVisibleFrames.length);
      setSimulationChunkCount(simulation.chunkCount);
      setSimulationFrameIndex(finalFrameIndex);
      setIsSimulationMode(nextIsSimulationMode);
      loadedSimulationFrameRef.current = {
        simulationId: simulation.simulationId,
        frameIndex: nextIsSimulationMode ? finalFrameIndex : null,
      };

      setSimulationToolMeshUrl(resolveBackendAssetUrl(simulation.toolMeshUrl));
      setSimulationFinalMeshUrl(resolveBackendAssetUrl(simulation.finalMeshUrl));

      if (!finalFrame || !nextIsSimulationMode) {
        if (!finalFrame) {
          updateSimulationActiveMeshUrl(null);
          updateSimulationCachedMeshUrl(null);
        }
        setIsSimulationPlaying(false);
        return;
      }

      const applied = await applySimulationFrame(
        simulation.simulationId,
        finalFrameIndex,
        finalFrame,
      );
      if (!applied) {
        return;
      }

      setIsSimulationPlaying(false);
    },
    [applySimulationFrame, simulationStride, updateSimulationActiveMeshUrl, updateSimulationCachedMeshUrl],
  );

  useEffect(() => {
    if (!isSimulationMode || !simulationId || simulationFrameCount === 0) {
      return undefined;
    }

    if (simulationFrameIndex < 0 || simulationFrameIndex >= simulationFrameCount) {
      return undefined;
    }

    if (
      loadedSimulationFrameRef.current.simulationId === simulationId &&
      loadedSimulationFrameRef.current.frameIndex === simulationFrameIndex
    ) {
      return undefined;
    }

    const frame = visibleSimulationFrames[simulationFrameIndex];
    if (!frame) {
      return undefined;
    }

    let cancelled = false;
    const requestId = simulationFrameDisplayRequestRef.current + 1;
    simulationFrameDisplayRequestRef.current = requestId;

    void applySimulationFrame(
      simulationId,
      simulationFrameIndex,
      frame,
      () => !cancelled && simulationFrameDisplayRequestRef.current === requestId,
    ).catch((error: unknown) => {
      if (cancelled) {
        return;
      }

      console.error("Failed to load simulation frame", error);
      setIsSimulationPlaying(false);
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to load simulation frame.",
      );
    });

    return () => {
      cancelled = true;
    };
  }, [applySimulationFrame, isSimulationMode, simulationFrameCount, simulationFrameIndex, simulationId, visibleSimulationFrames]);

  useEffect(() => {
    if (!isSimulationPlaying || !simulationId || simulationFrameCount <= 1) {
      return undefined;
    }

    if (simulationFrameIndex >= simulationFrameCount - 1) {
      setIsSimulationPlaying(false);
      return undefined;
    }

    if (displayedSimulationFrameIndex !== simulationFrameIndex) {
      return undefined;
    }

    let cancelled = false;
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        try {
          const nextFrameIndex = simulationFrameIndex + 1;
          const frame = visibleSimulationFrames[nextFrameIndex];
          if (!frame || cancelled) {
            return;
          }

          const applied = await applySimulationFrame(
            simulationId,
            nextFrameIndex,
            frame,
            () => !cancelled,
          );
          if (!applied || cancelled) {
            return;
          }

          setSimulationFrameIndex(nextFrameIndex);
        } catch (error) {
          if (cancelled) {
            return;
          }

          console.error("Failed to advance simulation playback", error);
          setIsSimulationPlaying(false);
          setRequestState("error");
          setRequestMessage(
            error instanceof Error ? error.message : "Failed to load simulation frame.",
          );
        }
      })();
    }, SIMULATION_PLAYBACK_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [
    applySimulationFrame,
    displayedSimulationFrameIndex,
    isSimulationPlaying,
    simulationFrameCount,
    simulationFrameIndex,
    simulationId,
    visibleSimulationFrames,
  ]);

  function resetGeneratedPreview() {
    setGeneratedOperation(null);
    resetSimulationPlaybackState();
    setRequestState("idle");
    setRequestMessage("");
    setIsSimulationMode(false);
  }

  function handleMeshFaceSelect(selection: MeshFaceSelection) {
    setSelectedMeshFace(selection);
    resetGeneratedPreview();
    setFaceSelectionMode(false);

    if (resumeOperationDialogAfterSelection && operationDraft) {
      setOperationDraft(applySelectionToOperationDraft(operationDraft, selection));
      setIsOperationDialogOpen(true);
      setResumeOperationDialogAfterSelection(false);
    }
  }

  function handleStartDialogGeometrySelection() {
    if (!operationDraft) {
      return;
    }

    setIsOperationDialogOpen(false);
    setResumeOperationDialogAfterSelection(true);
    setFaceSelectionMode(true);
    setRequestState("idle");
    setRequestMessage("Select an XY-planar edge loop in the viewport. Press Escape to cancel.");
  }

  useEffect(() => {
    if (!faceSelectionMode || !resumeOperationDialogAfterSelection) {
      return undefined;
    }

    const handleSelectionCancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setFaceSelectionMode(false);
      setIsOperationDialogOpen(true);
      setResumeOperationDialogAfterSelection(false);
      setRequestMessage("");
    };

    window.addEventListener("keydown", handleSelectionCancel);
    return () => window.removeEventListener("keydown", handleSelectionCancel);
  }, [faceSelectionMode, resumeOperationDialogAfterSelection]);

  function handleAddOperation() {
    if (!meshUrl) {
      setRequestState("error");
      setRequestMessage("Upload a STEP file before adding an operation.");
      return;
    }

    setIsOperationTypeDialogOpen(true);
  }

  function handleAddTypedOperation(operationType: OperationType) {
    if (!meshUrl) {
      setRequestState("error");
      setRequestMessage("Upload a STEP file before adding an operation.");
      return;
    }

    setIsOperationTypeDialogOpen(false);
    setOperationDialogMode("create");
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(createOperationDraft(operationType, operations.length + 1, null, meshMaxZ));
    setIsOperationDialogOpen(true);
  }

  function handleEditOperation(operationId: string) {
    const operationIndex = operations.findIndex((operation) => operation.id === operationId);
    const operation = operationIndex >= 0 ? operations[operationIndex] : null;
    if (!operation) {
      return;
    }

    setSelectedOperationId(operationId);
    setSelectedTreeNodeId(operationId);
    setIsOperationTypeDialogOpen(false);
    setOperationDialogMode("edit");
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(createOperationDraft((operation.type ?? "pocketing_2d") as OperationType, operationIndex + 1, null, meshMaxZ, operation));
    setIsOperationDialogOpen(true);
  }

  function handleRegenerateOperation(operationId: string) {
    const operation = operations.find((item) => item.id === operationId);
    if (!operation) {
      return;
    }

    setSelectedOperationId(operationId);
    setSelectedTreeNodeId(operationId);
    void handleGenerateOperation(operation);
  }

  function handleDeleteOperation(operationId: string) {
    setOperations((current) => current.filter((operation) => operation.id !== operationId));
    setGeneratedOperationsById((current) => {
      const next = { ...current };
      delete next[operationId];
      return next;
    });
    setGeneratedOperation(null);
    resetSimulationPlaybackState();
    setIsSimulationMode(false);
    setRequestState("idle");
    setRequestMessage("Operation deleted.");

    if (selectedOperationId === operationId || selectedTreeNodeId === operationId) {
      setSelectedOperationId(null);
      setSelectedTreeNodeId("setup-1");
    }
  }

  async function handleOperationDialogSave() {
    if (!operationDraft) {
      return;
    }

    try {
      const parsedOperation = parseOperationDraft(operationDraft);
      let nextOperations: Operation[];
      let operationsToGenerate: Operation[];

      if (operationDialogMode === "create") {
        nextOperations = [...operations, parsedOperation];
        operationsToGenerate = [parsedOperation];
      } else {
        const editedOperationIndex = operations.findIndex((operation) => operation.id === parsedOperation.id);
        if (editedOperationIndex < 0) {
          throw new Error("Operation not found.");
        }

        nextOperations = operations.map((operation) =>
          operation.id === parsedOperation.id ? parsedOperation : operation,
        );
        operationsToGenerate = nextOperations.slice(editedOperationIndex);
      }

      setOperations(nextOperations);
      setGeneratedOperationsById((current) => {
        const next = { ...current };
        for (const operation of operationsToGenerate) {
          if (operation.id) {
            delete next[operation.id];
          }
        }
        return next;
      });

      if (operationDialogMode === "edit" && operationsToGenerate.length > 1) {
        setSelectedOperationId(null);
        setSelectedTreeNodeId("setup-1");
      } else {
        setSelectedOperationId(parsedOperation.id ?? null);
        setSelectedTreeNodeId(parsedOperation.id ?? "setup-1");
      }

      setIsOperationDialogOpen(false);
      setResumeOperationDialogAfterSelection(false);
      setOperationDraft(null);
      queuedGenerationOperationsRef.current = operationsToGenerate.slice(1);
      await handleGenerateOperation(operationsToGenerate[0]);
    } catch (error) {
      queuedGenerationOperationsRef.current = [];
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to save operation.",
      );
    }
  }

  function handleDownloadOperationClData(operationId: string) {    const operation = operations.find((item) => item.id === operationId);
    const clData = generatedOperationsById[operationId];

    if (!operation || !clData) {
      setRequestState("error");
      setRequestMessage("Generate the operation before downloading its CL data.");
      return;
    }

    const fileStem = (operation.displayName ?? operation.id ?? "operation")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-") || "operation";
    const objectUrl = URL.createObjectURL(
      new Blob([JSON.stringify(clData, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `${fileStem}-cl.json`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  }

  async function downloadNcFile(clDataList: OperationRecord3D[], fileStem: string) {
    try {
      const response = await fetch(`${getBackendUrl()}/cam/post-process/duet3d/nc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clDataList),
      });
      if (!response.ok) {
        const detail = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(detail?.detail ?? `Post processing failed (${response.status}).`);
      }
      const ncText = await response.text();
      const objectUrl = URL.createObjectURL(new Blob([ncText], { type: "text/plain" }));
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `${fileStem}.nc`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (error) {
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to post-process the operation.",
      );
    }
  }

  async function handlePostProcessOperation(operationId: string) {
    const operation = operations.find((item) => item.id === operationId);
    const clData = generatedOperationsById[operationId];

    if (!operation || !clData) {
      setRequestState("error");
      setRequestMessage("Generate the operation before post-processing it.");
      return;
    }

    const fileStem = (operation.displayName ?? operation.id ?? "operation")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-") || "operation";
    await downloadNcFile([clData], fileStem);
  }

  async function handlePostProcessSetup(label: string) {
    const clDataList = operations.flatMap((operation) => {
      const clData = operation.id != null ? generatedOperationsById[operation.id] : null;
      return clData != null ? [clData] : [];
    });

    if (clDataList.length === 0) {
      setRequestState("error");
      setRequestMessage("Generate at least one operation before post-processing the setup.");
      return;
    }

    const fileStem = label.trim().replace(/\s+/g, "-") || "setup";
    await downloadNcFile(clDataList, fileStem);
  }

  async function handleCompareOperation(operationId: string) {
    setSelectedTreeNodeId(operationId);
    setSelectedOperationId(operationId);

    if (!simulationId || simulationFrameCount === 0 || operationId !== simulationOperationId) {
      setRequestState("error");
      setRequestMessage("Generate the selected operation before comparing it.");
      return;
    }

    resetComparisonPreview();
    const requestId = comparisonRequestRef.current;
    const comparisonStartedAt = performance.now();

    try {
      setRequestState("submitting");
      setRequestMessage("Preparing 1 mm comparison meshes...");
      const prepareStartedAt = performance.now();
      const response = await fetch(`${getBackendUrl()}/simulate/${simulationId}/comparison`);
      const prepareElapsedMs = performance.now() - prepareStartedAt;
      console.debug("[comparison] prepare", {
        simulationId,
        status: response.status,
        elapsedMs: prepareElapsedMs,
      });
      if (!response.ok) {
        const payload = (await response.json()) as { detail?: string };
        throw new Error(payload.detail ?? "Failed to prepare comparison meshes.");
      }

      const comparison = (await response.json()) as SweptSimulationComparisonResponse;
      const cachedMeshRequest = await prefetchMeshObjectUrlWithTiming(comparison.cachedMeshUrl, "no-store");
      console.debug("[comparison] cached mesh fetch", {
        simulationId,
        elapsedMs: cachedMeshRequest.elapsedMs,
        url: comparison.cachedMeshUrl,
      });
      const cachedMeshUrl = cachedMeshRequest.objectUrl;
      let activeMeshRequest: { objectUrl: string; elapsedMs: number };
      try {
        activeMeshRequest = await prefetchMeshObjectUrlWithTiming(comparison.activeMeshUrl, "no-store");
        console.debug("[comparison] active mesh fetch", {
          simulationId,
          elapsedMs: activeMeshRequest.elapsedMs,
          url: comparison.activeMeshUrl,
        });
      } catch (error) {
        URL.revokeObjectURL(cachedMeshUrl);
        throw error;
      }
      const activeMeshUrl = activeMeshRequest.objectUrl;
      if (comparisonRequestRef.current !== requestId) {
        URL.revokeObjectURL(cachedMeshUrl);
        URL.revokeObjectURL(activeMeshUrl);
        return;
      }

      console.debug("[comparison] ready", {
        simulationId,
        totalElapsedMs: performance.now() - comparisonStartedAt,
        prepareElapsedMs,
        cachedMeshFetchMs: cachedMeshRequest.elapsedMs,
        activeMeshFetchMs: activeMeshRequest.elapsedMs,
      });
      comparisonObjectUrlsRef.current = [cachedMeshUrl, activeMeshUrl];
      setComparisonCachedMeshUrl(cachedMeshUrl);
      setComparisonActiveMeshUrl(activeMeshUrl);
      setIsSimulationPlaying(false);
      setIsSimulationMode(false);
      setIsComparisonMode(true);
      setShowStock(true);
      setRequestState("success");
      setRequestMessage("Comparison meshes ready.");
    } catch (error) {
      if (comparisonRequestRef.current !== requestId) {
        return;
      }
      console.debug("[comparison] failed", {
        simulationId,
        elapsedMs: performance.now() - comparisonStartedAt,
        error,
      });
      setRequestState("error");
      setRequestMessage(error instanceof Error ? error.message : "Failed to prepare comparison meshes.");
    }
  }

  function handleSimulateOperation(operationId: string) {
    setSelectedTreeNodeId(operationId);
    setSelectedOperationId(operationId);

    if (!simulationId || simulationFrameCount === 0 || operationId !== simulationOperationId) {
      setRequestState("error");
      setRequestMessage("Generate the selected operation before simulating it.");
      return;
    }

    handleEnterSimulation();
  }

  function handleEnterSimulation() {
    if (!simulationId || simulationFrameCount === 0) {
      return;
    }

    resetComparisonPreview();
    setShowStock(true);
    setIsSimulationMode(true);
  }

  function handleExitSimulation() {
    setIsSimulationPlaying(false);
    setIsSimulationMode(false);
  }

  function handleExitComparison() {
    resetComparisonPreview();
  }

  function handleSimulationFrameChange(values: number[]) {
    if (!simulationId || simulationFrameCount === 0) {
      return;
    }

    const nextFrameIndex = Math.max(
      0,
      Math.min(Math.round(values[0] ?? 0), simulationFrameCount - 1),
    );

    setIsSimulationPlaying(false);
    handleEnterSimulation();
    setSimulationFrameIndex(nextFrameIndex);
  }

  function handleSimulationPlay() {
    if (!simulationId || simulationFrameCount === 0) {
      return;
    }

    handleEnterSimulation();
    setSimulationFrameIndex((current) =>
      current >= simulationFrameCount - 1 && simulationFrameCount > 1 ? 0 : current,
    );
    setIsSimulationPlaying(true);
  }

  function handleSimulationStrideChange(values: number[]) {
    const nextOptionIndex = Math.max(
      0,
      Math.min(Math.round(values[0] ?? 0), SIMULATION_STRIDE_OPTIONS.length - 1),
    );
    const nextStride = SIMULATION_STRIDE_OPTIONS[nextOptionIndex];
    if (nextStride === simulationStride) {
      return;
    }

    const currentFrameProgress =
      simulationFrameCount > 1 ? simulationFrameIndex / (simulationFrameCount - 1) : 0;
    const nextFrameCount = simulationStrideFrameCount(simulationDisplayFrames.length, nextStride);
    const nextFrameIndex = Math.max(
      0,
      Math.min(
        Math.round(currentFrameProgress * Math.max(nextFrameCount - 1, 0)),
        Math.max(nextFrameCount - 1, 0),
      ),
    );

    loadedSimulationFrameRef.current = {
      simulationId: null,
      frameIndex: null,
    };
    simulationFrameDisplayRequestRef.current += 1;
    setSimulationStride(nextStride);
    setSimulationFrameCount(nextFrameCount);
    setSimulationFrameIndex(nextFrameIndex);
  }

  function handleSimulationPause() {
    setIsSimulationPlaying(false);
  }

  useEffect(() => {
    sendRhinoUiDebug("info", "UI request state changed", {
      requestState,
      requestMessage,
      selectedOperation,
      hasMesh: Boolean(meshUrl),
      hasFaceSelection: Boolean(selectedMeshFace),
      hasGeneratedOperation: Boolean(generatedOperation),
      simulationTaskId,
      simulationId,
      isSimulationMode,
    });
  }, [generatedOperation, isSimulationMode, meshUrl, requestMessage, requestState, selectedMeshFace, selectedOperation, simulationId, simulationTaskId]);

  useEffect(() => {
    if (!simulationTaskId || requestState !== "submitting") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollStatus = async () => {
      try {
        const response = await fetch(`${getBackendUrl()}/simulate/${simulationTaskId}/status`);
        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { detail?: string };
            throw new Error(payload.detail ?? "Failed to load simulation status.");
          }

          const detail = await response.text();
          throw new Error(detail || "Failed to load simulation status.");
        }

        const status = (await response.json()) as SweptSimulationStatusResponse;
        if (cancelled) {
          return;
        }

        setSimulationProgressPercent(status.progressPercent);
        setRequestMessage(
          `${status.message ?? "Running chunked swept milling simulation..."} (${Math.round(status.progressPercent)}%)`,
        );

        if (status.status === "completed") {
          if (!status.result) {
            throw new Error("Simulation completed without a result.");
          }

          setSimulationTaskId(null);
          setGeneratingOperationId(null);
          setSimulationProgressPercent(100);
          await applyCompletedSimulation(status.result);

          const nextQueuedOperation = queuedGenerationOperationsRef.current.shift() ?? null;
          if (nextQueuedOperation) {
            setGeneratingOperationId(nextQueuedOperation.id ?? null);
            setSimulationProgressPercent(0);
            void handleGenerateOperation(nextQueuedOperation);
            return;
          }

          setGeneratingOperationId(null);
          setRequestState("success");
          setRequestMessage(
            `${currentGenerationLabelRef.current} toolpaths generated and chunked swept simulation completed.`,
          );
          return;
        }

        if (status.status === "cancelled") {
          queuedGenerationOperationsRef.current = [];
          setGeneratingOperationId(null);
          setSimulationTaskId(null);
          setSimulationProgressPercent(0);
          resetSimulationPlaybackState();
          setIsSimulationMode(false);
          setRequestState("idle");
          setRequestMessage("Simulation generation cancelled.");
          return;
        }

        if (status.status === "error") {
          throw new Error(status.errorDetail ?? status.message ?? "Swept simulation failed.");
        }

        timeoutId = window.setTimeout(() => {
          void pollStatus();
        }, 500);
      } catch (error) {
        if (cancelled) {
          return;
        }

        queuedGenerationOperationsRef.current = [];
        setGeneratingOperationId(null);
        setSimulationTaskId(null);
        setSimulationProgressPercent(0);
        resetSimulationPlaybackState();
        setIsSimulationMode(false);
        setRequestState("error");
        setRequestMessage(
          error instanceof Error ? error.message : "Failed to generate toolpath.",
        );
      }
    };

    void pollStatus();

    return () => {
      cancelled = true;
      if (timeoutId != null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [applyCompletedSimulation, requestState, simulationTaskId]);

  async function handleGenerateOperation(operationToGenerate = selectedOperation) {
    if (!operationToGenerate) {
      setRequestState("error");
      setRequestMessage("Add and select a pocket operation before generating a toolpath.");
      return;
    }

    if (!meshUrl) {
      setRequestState("error");
      setRequestMessage("Upload a STEP file before generating a toolpath.");
      return;
    }

    if (!cachedMeshVersion) {
      setRequestState("error");
      setRequestMessage("Wait for the part mesh to finish processing before generating a toolpath.");
      return;
    }

    try {
      if (simulationTaskId) {
        await fetch(`${getBackendUrl()}/simulate/${simulationTaskId}`, { method: "DELETE" });
      }

      const requestBody = buildGenerateToolpathRequest(
        operationToGenerate,
        meshMaxZ,
        cachedMeshVersion,
        clearanceOffset,
      );
      const nextOperationLabel = operationToGenerate.displayName ?? "2D Pocket";

      currentGenerationLabelRef.current = nextOperationLabel;
      setGeneratingOperationId(operationToGenerate.id ?? null);
      setSimulationProgressPercent(0);
      setGeneratedOperation(null);
      if (operationToGenerate.id) {
        setGeneratedOperationsById((current) => {
          const next = { ...current };
          delete next[operationToGenerate.id!];
          return next;
        });
      }
      resetSimulationPlaybackState();
      setSimulationOperationId(operationToGenerate.id ?? null);
      setIsSimulationMode(false);
      setRequestState("submitting");
      setRequestMessage(`Generating ${nextOperationLabel.toLowerCase()} toolpath...`);

      const response = await fetch(`${getBackendUrl()}/cam/toolpath`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { detail?: string };
          throw new Error(payload.detail ?? "Backend request failed.");
        }

        const detail = await response.text();
        throw new Error(detail || "Backend request failed.");
      }

      const operation = (await response.json()) as GeneratedOperationResponse;
      const simulationRequest = new FormData();
      simulationRequest.append("operation", JSON.stringify(operation));
      const runId = response.headers.get("X-Toolpath-Run-Id");
      if (runId) simulationRequest.append("run_id", runId);
      simulationRequest.append("chunk_padding_x", String(CHUNK_PADDING_X));
      simulationRequest.append("chunk_padding_y", String(CHUNK_PADDING_Y));
      simulationRequest.append("chunk_padding_z", String(CHUNK_PADDING_Z));
      simulationRequest.append("chunk_step_distance", String(SIMULATION_CONTACT_STEP_DISTANCE));
      setGeneratedOperation(operation);
      if (operationToGenerate.id) {
        setGeneratedOperationsById((current) => ({ ...current, [operationToGenerate.id!]: operation }));
      }
      setRequestMessage("Starting chunked swept milling simulation...");

      const simulationResponse = await fetch(`${getBackendUrl()}/simulate`, {
        method: "POST",
        body: simulationRequest,
      });

      if (!simulationResponse.ok) {
        const contentType = simulationResponse.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await simulationResponse.json()) as { detail?: string };
          throw new Error(payload.detail ?? "Swept simulation failed.");
        }

        const detail = await simulationResponse.text();
        throw new Error(detail || "Swept simulation failed.");
      }

      const simulationStart = (await simulationResponse.json()) as SweptSimulationStartResponse;
      setSimulationTaskId(simulationStart.taskId);
      setSimulationProgressPercent(0);
      setRequestMessage("Preparing simulation... (0%)");
    } catch (error) {
      queuedGenerationOperationsRef.current = [];
      setGeneratingOperationId(null);
      setGeneratedOperation(null);
      resetSimulationPlaybackState();
      setIsSimulationMode(false);
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to generate toolpath.",
      );
    }
  }

  async function handleCancelGeneration() {
    if (!simulationTaskId) {
      return;
    }

    try {
      queuedGenerationOperationsRef.current = [];
      await fetch(`${getBackendUrl()}/simulate/${simulationTaskId}`, {
        method: "DELETE",
      });
      setRequestMessage(`Cancelling simulation... (${Math.round(simulationProgressPercent)}%)`);
    } catch (error) {
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to cancel simulation generation.",
      );
    }
  }

  async function handleMeshUpload(file: File | null) {
    const requestId = meshUploadRequestRef.current + 1;
    meshUploadRequestRef.current = requestId;
    meshRestoreAbortRef.current?.abort();
    meshRestoreAbortRef.current = null;
    removeCachedMeshFromLocalStorage();
    queuedGenerationOperationsRef.current = [];

    setMeshName(null);
    setMeshUrl(null);
    setMeshCacheState(file ? "saving" : "idle");
    setMeshCacheMessage("");
    setMeshMaxZ(null);
    setCachedMeshVersion(null);
    setSelectedMeshFace(null);
    setOperations([]);
    setGeneratingOperationId(null);
    setSelectedOperationId(null);
    setSelectedTreeNodeId("setup-1");
    setGeneratedOperation(null);
    setGeneratedOperationsById({});
    resetSimulationPlaybackState();
    setRequestState("idle");
    setRequestMessage("");
    setIsSimulationMode(false);
    setFaceSelectionMode(false);
    setIsOperationTypeDialogOpen(false);
    setIsOperationDialogOpen(false);
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(null);

    if (!file) {
      void fetch(`${getBackendUrl()}/cam/mesh`, { method: "DELETE" }).catch(() => undefined);
      return;
    }

    try {
      const localMesh = await saveMeshToLocalStorage(
        file,
        () => meshUploadRequestRef.current === requestId,
      );
      if (meshUploadRequestRef.current !== requestId) {
        return;
      }

      setMeshName(localMesh.payload.name);
      setMeshUrl(null);
      setMeshMaxZ(null);
      setMeshCacheState("saving");
      setMeshCacheMessage(
        localMesh.saved
          ? "Cached in browser localStorage. Processing STEP in backend..."
          : "Processing STEP in backend...",
      );

      try {
        const cachedMesh = await uploadStepToBackend(file, file.name);
        if (meshUploadRequestRef.current !== requestId) {
          return;
        }

        setMeshUrl(resolveBackendAssetUrl(cachedMesh.meshUrl));
        setMeshMaxZ(cachedMesh.maxZ);
        setCachedMeshVersion(cachedMesh.version);
        setMeshCacheState("ready");
        setMeshCacheMessage(
          localMesh.saved
            ? "STEP and mesh cached in browser and backend memory."
            : "STEP and mesh cached in backend memory.",
        );
      } catch (error: unknown) {
        if (meshUploadRequestRef.current !== requestId) {
          return;
        }

        console.error("Failed to cache STEP in backend", error);
        setMeshCacheState("error");
        setMeshCacheMessage("Backend STEP processing unavailable.");
      }
    } catch (error) {
      if (meshUploadRequestRef.current !== requestId) {
        return;
      }

      setMeshCacheState("error");
      setMeshCacheMessage(
        error instanceof Error ? error.message : "Failed to cache STEP in browser.",
      );
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to cache STEP in browser.",
      );
    }
  }

  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-2 py-1.5 md:px-2">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h2 className="text-sm font-semibold md:text-base">OpenCAM Viewer</h2>
          </div>

          <SettingsDialog />
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <AppSidebar
            simulatableOperationIds={simulatableOperationIds}
            comparableOperationIds={comparableOperationIds}
            downloadableOperationIds={downloadableOperationIds}
            generatingOperationId={generatingOperationId}
            generatingOperationProgressPercent={simulationProgressPercent}
            isToolpathGenerating={generatedOperation === null && requestState === "submitting"}
            isSimulationGenerating={generatedOperation !== null && requestState === "submitting"}
            onMeshUpload={handleMeshUpload}
            onAddOperation={handleAddOperation}
            onEditOperation={handleEditOperation}
            onRegenerateOperation={handleRegenerateOperation}
            onDeleteOperation={handleDeleteOperation}
            onSimulateOperation={handleSimulateOperation}
            onCompareOperation={handleCompareOperation}
            onDownloadOperationClData={handleDownloadOperationClData}
            onPostProcessOperation={handlePostProcessOperation}
            onPostProcessSetup={handlePostProcessSetup}
            canManageOperations={requestState !== "submitting" || generatedOperation !== null}
            canCancelGeneration={requestState === "submitting" && simulationTaskId !== null}
            onCancelGeneration={handleCancelGeneration}
          />

          <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
                <PolylineViewer
                  meshUrl={meshUrl}
                  secondaryMeshUrl={secondaryMeshUrl}
                  tertiaryMeshUrl={tertiaryMeshUrl}
                  meshColor={ORIGINAL_MESH_COLOR}
                  meshUseVertexColors
                  meshEdgeColor={ORIGINAL_MESH_EDGE_COLOR}
                  secondaryMeshColor={activeMeshColor}
                  secondaryMeshUseVertexColors
                  secondaryMeshEdgeColor={null}
                  tertiaryMeshColor={stockMeshColor}
                  tertiaryMeshUseVertexColors
                  tertiaryMeshEdgeColor={null}
                  meshOpacity={showPartMesh && showStock && (isSimulationMode || isComparisonMode || hasCompletedSimulationStock) ? 0.3 : 1}
                  showMesh={showPartMesh}
                  showSecondaryMesh={showStock && (isSimulationMode || isComparisonMode || hasCompletedSimulationStock)}
                  showTertiaryMesh={showStock && (isSimulationMode || isComparisonMode)}
                  showSimulationStock={showStock && !isSimulationMode && !isComparisonMode && !hasCompletedSimulationStock}
                  showTool={showTool && isSimulationMode}
                  polylines={showToolpaths ? viewportPolylines : []}
                  faceSelectionMode={faceSelectionMode}
                  selectedMeshFace={null}
                  selectedMeshFaces={highlightedMeshFaces}
                  simulationSamples={simulationSamples}
                  simulationStep={isSimulationMode ? (displayedSimulationFrameIndex ?? simulationFrameIndex) : 0}
                  simulationToolMeshUrl={simulationToolMeshUrl}
                  simulationToolPosition={simulationToolPosition}
                  toolRenderMode={toolRenderMode}
                  partRenderMode={partRenderMode}
                  stockRenderMode={stockRenderMode}
                  showOriginalMesh={!isSimulationMode}
                  onMeshFaceSelect={handleMeshFaceSelect}
                  onSecondaryMeshDisplayed={handleSecondaryMeshDisplayed}
                  onTertiaryMeshDisplayed={handleTertiaryMeshDisplayed}
                  className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none"
                />

                <VisibilityBar />

                <SimulationDebugOverlay
                  visible={simulationDebugUiEnabled && Boolean(simulationId)}
                  simulationId={simulationId}
                  clRecordIndex={displayedSimulationFrameIndex == null
                    ? null
                    : visibleSimulationFrames[displayedSimulationFrameIndex]?.clRecordIndex ?? null}
                  chunkIndex={simulationChunkIndex}
                  chunkCount={simulationChunkCount}
                  stepIndex={simulationChunkStepIndex}
                  stepCount={simulationChunkStepCount}
                  focusMeshRequestMs={simulationFocusMeshRequestMs}
                  chunkFetchMs={simulationChunkFetchMs}
                />

            <AnimationBar
              disabled={requestState === "submitting"}
              onFrameChange={handleSimulationFrameChange}
              onPlay={handleSimulationPlay}
              onPause={handleSimulationPause}
              onStrideChange={handleSimulationStrideChange}
              onExit={handleExitSimulation}
            />

            {isComparisonMode ? (
              <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20">
                <div className="pointer-events-auto mx-auto flex max-w-4xl items-center justify-between gap-3 rounded-md border bg-background/95 px-2 py-2 shadow">
                  <span className="text-sm font-medium">Stock comparison</span>
                  <Button type="button" variant="ghost" size="icon-xs" onClick={handleExitComparison} aria-label="Close comparison" title="Close comparison">
                    <X />
                  </Button>
                </div>
              </div>
            ) : null}
          </main>
        </div>

        <OperationTypeDialog
          open={isOperationTypeDialogOpen}
          onOpenChange={setIsOperationTypeDialogOpen}
          onSelectPocketing={() => handleAddTypedOperation("pocketing_2d")}
          onSelectProfiling={() => handleAddTypedOperation("profiling_2d")}
          onSelectParallelFinishing={() => handleAddTypedOperation("parallel_finishing")}
        />

        <OperationDialog
          open={isOperationDialogOpen}
          draft={operationDraft}
          mode={operationDialogMode}
          rootSchema={getOperationSchema(operationDraft)}
          onDraftChange={setOperationDraft}
          onOpenChange={(open) => {
            setIsOperationDialogOpen(open);
            if (!open) {
              setResumeOperationDialogAfterSelection(false);
              setOperationDraft(null);
            }
          }}
          onSave={handleOperationDialogSave}
          onStartGeometrySelection={handleStartDialogGeometrySelection}
        />
      </div>
    </SidebarProvider>
  );
}

export default App;
