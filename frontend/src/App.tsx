import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar, type RequestState } from "@/components/app-sidebar";
import { meshBlobForBackend } from "@/components/polyline-viewer/mesh-export";
import { loadMeshGeometry } from "@/components/polyline-viewer/mesh-loader";
import { SettingsDialog } from "@/components/settings-dialog";
import { OperationDialog } from "@/components/operation-dialog";
import { OperationTypeDialog } from "@/components/operation-type-dialog";
import { SimulationDebugOverlay } from "@/components/simulation-debug-overlay";
import { PolylineViewer } from "@/components/polyline-viewer/viewer";
import type {
  MeshFaceSelection,
  PolylineDefinition,
  PolylinePoint,
  ToolRenderMode,
} from "@/components/polyline-viewer/types";
import { Button } from "t-components/button";
import { X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { SidebarProvider, SidebarTrigger } from "t-components/sidebar";
import { getOpenCamBootstrap, sendRhinoUiDebug } from "@/bootstrap";
import type { DraftObject, Operation, OperationType } from "@/lib/cam-schema";
import {
  applySelectionToOperationDraft,
  buildGenerateToolpathRequest,
  createOperationDraft,
  getGeometryArrayKey,
  getOperationSchema,
  parseOperationDraft,
} from "@/lib/cam-schema";
import { getBackendUrl } from "@/hooks/useBackendConnection";
import type { ClosedPolyline25D } from "@/generated_schemas/geometry_2_5d";
import {
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
  toolPosition: ToolPositionResponse;
};

const CUT_PATH_COLOR = "#1d4ed8";
const CLEARANCE_PATH_COLOR = "#dc2626";

function createDisplayPolylines(records: ReadonlyArray<PositionRecord3D>): PolylineDefinition[] {
  const polylines: PolylineDefinition[] = [];
  let points: PolylinePoint[] = [];
  let feedType: PositionRecord3D["feedType"] | null = null;

  for (let index = 1; index < records.length; index += 1) {
    const start = records[index - 1];
    const end = records[index];
    if (feedType !== end.feedType) {
      points = [[start.x, start.y, start.z], [end.x, end.y, end.z]];
      feedType = end.feedType;
      polylines.push({
        id: `record-${index}`,
        name: feedType === "rapid" ? "Rapid moves" : "Feed moves",
        color: feedType === "rapid" ? CLEARANCE_PATH_COLOR : CUT_PATH_COLOR,
        kind: feedType,
        points,
      });
    } else {
      points.push([end.x, end.y, end.z]);
    }
  }

  return polylines;
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
const SIMULATION_DEBUG_UI_STORAGE_KEY = "opencam.simulation-debug-ui";
const TOOL_RENDER_MODE_STORAGE_KEY = "opencam.tool-render-mode.v1";
const PART_RENDER_MODE_STORAGE_KEY = "opencam.part-render-mode.v1";
const STOCK_RENDER_MODE_STORAGE_KEY = "opencam.stock-render-mode.v1";
const CLEARANCE_OFFSET_STORAGE_KEY = "opencam.clearance-offset.v2";
const DEFAULT_CLEARANCE_OFFSET = 10;
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
const SIMULATION_STRIDE_OPTIONS = [1, 2, 4, 8, 16] as const;
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

async function getMeshMaxZ(meshUrl: string) {
  const geometry = await loadMeshGeometry(meshUrl);
  try {
    geometry.computeBoundingBox();
    const maxZ = geometry.boundingBox?.max.z;
    if (typeof maxZ !== "number" || !Number.isFinite(maxZ)) {
      throw new Error("Unable to determine STEP bounds.");
    }

    return maxZ;
  } finally {
    geometry.dispose();
  }
}

async function saveMeshToLocalStorage(file: File, shouldSave: () => boolean = () => true) {
  const dataUrl = await readFileAsDataUrl(file);
  const payload = {
    name: file.name,
    dataUrl,
    maxZ: await getMeshMaxZ(dataUrl),
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

async function uploadMeshToBackend(mesh: Blob, name: string, signal?: AbortSignal) {
  const backendMesh = await meshBlobForBackend(mesh, name);
  const upload = new FormData();
  upload.append("mesh", backendMesh.blob, backendMesh.name);

  const response = await fetch(`${getBackendUrl()}/cam/mesh`, {
    method: "POST",
    body: upload,
    signal,
  });

  return readCachedMeshResponse(response, "Failed to cache mesh in backend.");
}

async function uploadLocalStorageMeshToBackend(cachedMesh: LocalCachedMeshPayload, signal?: AbortSignal) {
  const meshResponse = await fetch(cachedMesh.dataUrl, { signal });
  const meshBlob = await meshResponse.blob();
  return uploadMeshToBackend(meshBlob, cachedMesh.name, signal);
}

async function appendFrontendCachedMesh(formData: FormData, currentMeshUrl: string | null, currentMeshName: string | null) {
  const cachedMesh = readCachedMeshFromLocalStorage();
  const meshDataUrl = cachedMesh?.dataUrl ?? (currentMeshUrl?.startsWith("data:") ? currentMeshUrl : null);
  if (!meshDataUrl) {
    return;
  }

  const backendMesh = await meshBlobForBackend(meshDataUrl, cachedMesh?.name ?? currentMeshName ?? "mesh.stl");
  formData.append("mesh", backendMesh.blob, backendMesh.name);
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

function geometryToMeshFaceSelection(geometry: ClosedPolyline25D, index: number): MeshFaceSelection {
  return {
    id: `geometry-${index}`,
    label: `Edge loop ${index + 1}`,
    normal: [0, 0, 1],
    triangleIndices: [],
    triangleCount: 0,
    area: 0,
    isParallelToXY: true,
    planeZ: geometry.z,
    boundaryLoop: geometry.vertices.map(({ x, y }) => [x, y, geometry.z] as const),
    validationError: null,
  };
}

function asList<T>(value: T | T[] | undefined): T[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

function operationToMeshFaceSelections(operation: Operation | null): MeshFaceSelection[] {
  if (!operation) {
    return [];
  }
  const geometryKey = getGeometryArrayKey(getOperationSchema(operation));
  const driveGeometry = operation.driveGeometry as Record<string, ClosedPolyline25D | ClosedPolyline25D[] | undefined>;
  return asList(geometryKey ? driveGeometry[geometryKey] : undefined).map(geometryToMeshFaceSelection);
}

function draftToMeshFaceSelections(draft: DraftObject | null): MeshFaceSelection[] {
  const geometryKey = draft ? getGeometryArrayKey(getOperationSchema(draft)) : null;
  const geometries = asList(geometryKey ? (draft?.driveGeometry as DraftObject | undefined)?.[geometryKey] : undefined);

  return geometries.flatMap((geometry, index) => {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
      return [];
    }

    const z = Number((geometry as DraftObject).z);
    const vertices = (geometry as DraftObject).vertices;
    if (!Number.isFinite(z) || !Array.isArray(vertices)) {
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

    return [geometryToMeshFaceSelection({ z, vertices: parsedVertices as ClosedPolyline25D["vertices"] }, index)];
  });
}

function buildSimulationDisplayFrames(
  simulationId: string,
  chunks: ReadonlyArray<SimulationChunkResponse>,
): SimulationDisplayFrame[] {
  return chunks.flatMap((chunk, chunkIndex) =>
    chunk.frames.map((frame) => ({
      activeMeshUrl: `/simulate/${simulationId}/chunks/${chunkIndex}/active-meshes/${frame.activeMeshIndex}.glb`,
      activeMeshKey: `${chunkIndex}:${frame.activeMeshIndex}`,
      cachedMeshUrl: chunk.cachedMeshUrl,
      chunkIndex,
      toolPosition: frame.toolPosition,
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

function simulationStrideOptionIndex(stride: number) {
  const index = SIMULATION_STRIDE_OPTIONS.indexOf(stride as (typeof SIMULATION_STRIDE_OPTIONS)[number]);
  return index >= 0 ? index : 0;
}

function App() {
  const [meshName, setMeshName] = useState<string | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [, setMeshCacheState] = useState<MeshCacheState>("idle");
  const [, setMeshCacheMessage] = useState<string>("");
  const meshUploadRequestRef = useRef(0);
  const meshRestoreAbortRef = useRef<AbortController | null>(null);
  const hasInitializedSidebarSettingsRef = useRef(false);
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);
  const [meshMaxZ, setMeshMaxZ] = useState<number | null>(null);
  const [cachedMeshVersion, setCachedMeshVersion] = useState<string | null>(null);
  const [operations, setOperations] = useState<Operation[]>([]);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [selectedTreeNodeId, setSelectedTreeNodeId] = useState("setup-1");
  const [isOperationTypeDialogOpen, setIsOperationTypeDialogOpen] = useState(false);
  const [isOperationDialogOpen, setIsOperationDialogOpen] = useState(false);
  const [operationDialogMode, setOperationDialogMode] = useState<"create" | "edit">("create");
  const [resumeOperationDialogAfterSelection, setResumeOperationDialogAfterSelection] = useState(false);
  const [operationDraft, setOperationDraft] = useState<DraftObject | null>(null);
  const [generatedOperation, setGeneratedOperation] =
    useState<GeneratedOperationResponse | null>(null);
  const [generatedOperationsById, setGeneratedOperationsById] = useState<Record<string, GeneratedOperationResponse>>({});
  const [simulationActiveMeshUrl, setSimulationActiveMeshUrl] = useState<string | null>(null);
  const [simulationCachedMeshUrl, setSimulationCachedMeshUrl] = useState<string | null>(null);
  const [simulationFinalMeshUrl, setSimulationFinalMeshUrl] = useState<string | null>(null);
  const [simulationToolMeshUrl, setSimulationToolMeshUrl] = useState<string | null>(null);
  const [simulationToolPosition, setSimulationToolPosition] = useState<PolylinePoint | null>(null);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [simulationOperationId, setSimulationOperationId] = useState<string | null>(null);
  const [simulationTaskId, setSimulationTaskId] = useState<string | null>(null);
  const [generatingOperationId, setGeneratingOperationId] = useState<string | null>(null);
  const [simulationProgressPercent, setSimulationProgressPercent] = useState(0);
  const [simulationFrameCount, setSimulationFrameCount] = useState(0);
  const [simulationChunkCount, setSimulationChunkCount] = useState(0);
  const [simulationChunkIndex, setSimulationChunkIndex] = useState<number | null>(null);
  const [simulationChunkStepIndex, setSimulationChunkStepIndex] = useState<number | null>(null);
  const [simulationChunkStepCount, setSimulationChunkStepCount] = useState(0);
  const [simulationFocusMeshRequestMs, setSimulationFocusMeshRequestMs] = useState<number | null>(null);
  const [simulationChunkFetchMs, setSimulationChunkFetchMs] = useState<number | null>(null);
  const [simulationChunkToolpathPoints, setSimulationChunkToolpathPoints] = useState<PolylinePoint[]>([]);
  const [simulationDisplayFrames, setSimulationDisplayFrames] = useState<SimulationDisplayFrame[]>([]);
  const [simulationFrameIndex, setSimulationFrameIndex] = useState(0);
  const [simulationStride, setSimulationStride] = useState<number>(SIMULATION_STRIDE_OPTIONS[0]);
  const [displayedSimulationFrameIndex, setDisplayedSimulationFrameIndex] = useState<number | null>(null);
  const [isSimulationPlaying, setIsSimulationPlaying] = useState(false);
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
  const [isSimulationMode, setIsSimulationMode] = useState(false);
  const [isComparisonMode, setIsComparisonMode] = useState(false);
  const [comparisonCachedMeshUrl, setComparisonCachedMeshUrl] = useState<string | null>(null);
  const [comparisonActiveMeshUrl, setComparisonActiveMeshUrl] = useState<string | null>(null);
  const comparisonRequestRef = useRef(0);
  const comparisonObjectUrlsRef = useRef<string[]>([]);
  const [showStock, setShowStock] = useState(false);
  const [showPartMesh, setShowPartMesh] = useState(true);
  const [showToolpaths, setShowToolpaths] = useState(true);
  const [showTool, setShowTool] = useState(true);
  const [simulationDebugUiEnabled, setSimulationDebugUiEnabled] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    try {
      return window.localStorage.getItem(SIMULATION_DEBUG_UI_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [toolRenderMode, setToolRenderMode] = useState<ToolRenderMode>(() => {
    if (typeof window === "undefined") {
      return "wireframe";
    }

    try {
      return window.localStorage.getItem(TOOL_RENDER_MODE_STORAGE_KEY) === "shaded"
        ? "shaded"
        : "wireframe";
    } catch {
      return "wireframe";
    }
  });
  const [partRenderMode, setPartRenderMode] = useState<ToolRenderMode>(() => {
    if (typeof window === "undefined") {
      return "shaded";
    }

    try {
      return window.localStorage.getItem(PART_RENDER_MODE_STORAGE_KEY) === "wireframe"
        ? "wireframe"
        : "shaded";
    } catch {
      return "shaded";
    }
  });
  const [stockRenderMode, setStockRenderMode] = useState<ToolRenderMode>(() => {
    if (typeof window === "undefined") {
      return "shaded";
    }

    try {
      return window.localStorage.getItem(STOCK_RENDER_MODE_STORAGE_KEY) === "wireframe"
        ? "wireframe"
        : "shaded";
    } catch {
      return "shaded";
    }
  });
  const [clearanceOffset, setClearanceOffset] = useState(() => {
    if (typeof window === "undefined") {
      return DEFAULT_CLEARANCE_OFFSET;
    }

    try {
      const storedValue = window.localStorage.getItem(CLEARANCE_OFFSET_STORAGE_KEY);
      if (storedValue === null) {
        return DEFAULT_CLEARANCE_OFFSET;
      }

      const stored = Number(storedValue);
      return Number.isFinite(stored) && stored >= 0 ? stored : DEFAULT_CLEARANCE_OFFSET;
    } catch {
      return DEFAULT_CLEARANCE_OFFSET;
    }
  });

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
      return;
    }

    try {
      window.localStorage.setItem(
        SIMULATION_DEBUG_UI_STORAGE_KEY,
        simulationDebugUiEnabled ? "true" : "false",
      );
    } catch {
      // Ignore unavailable localStorage; the checkbox still works for this session.
    }
  }, [simulationDebugUiEnabled]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(TOOL_RENDER_MODE_STORAGE_KEY, toolRenderMode);
    } catch {
      // Ignore unavailable localStorage; the tabs switch still works for this session.
    }
  }, [toolRenderMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(PART_RENDER_MODE_STORAGE_KEY, partRenderMode);
    } catch {
      // Ignore unavailable localStorage; the tabs switch still works for this session.
    }
  }, [partRenderMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(STOCK_RENDER_MODE_STORAGE_KEY, stockRenderMode);
    } catch {
      // Ignore unavailable localStorage; the tabs switch still works for this session.
    }
  }, [stockRenderMode]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(CLEARANCE_OFFSET_STORAGE_KEY, String(clearanceOffset));
    } catch {
      // Ignore unavailable localStorage; the setting still works for this session.
    }
  }, [clearanceOffset]);

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
        const maxZ = localMesh.maxZ ?? (await getMeshMaxZ(localMesh.dataUrl));
        if (cancelled || meshUploadRequestRef.current !== requestId) {
          return;
        }

        setMeshName(localMesh.name);
        setMeshUrl(localMesh.dataUrl);
        setMeshMaxZ(maxZ);
        setMeshCacheState("ready");
        setMeshCacheMessage("Cached in browser localStorage. Restoring backend memory...");

        restoreController = new AbortController();
        meshRestoreAbortRef.current = restoreController;
        try {
          const restoredMesh = await uploadLocalStorageMeshToBackend(localMesh, restoreController.signal);
          if (!cancelled && meshUploadRequestRef.current === requestId) {
            setCachedMeshVersion(restoredMesh.version);
            setMeshCacheMessage("Cached in browser localStorage and backend memory.");
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

  const viewportPolylines = useMemo<PolylineDefinition[]>(() => {
    if (!simulationDebugUiEnabled || !isSimulationMode || simulationChunkToolpathPoints.length < 2) {
      return operationPolylines;
    }

    const startPoint = simulationChunkToolpathPoints[0];
    const endPoint = simulationChunkToolpathPoints[simulationChunkToolpathPoints.length - 1];
    return [
      ...operationPolylines,
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
  }, [isSimulationMode, operationPolylines, simulationChunkToolpathPoints, simulationDebugUiEnabled]);

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
      return draftToMeshFaceSelections(operationDraft);
    }

    return visibleOperations.flatMap(operationToMeshFaceSelections);
  }, [faceSelectionMode, isOperationDialogOpen, operationDraft, visibleOperations]);

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
      setSimulationChunkIndex(frame.chunkIndex);
      setSimulationChunkStepIndex(null);
      setSimulationChunkStepCount(0);
      setSimulationFocusMeshRequestMs(tertiaryElapsedMs);
      setSimulationChunkFetchMs(secondaryElapsedMs);
      setSimulationChunkToolpathPoints([]);
      setSimulationToolPosition(toolPositionToPoint(frame.toolPosition));
    },
    [],
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
        frameIndex: finalFrameIndex,
      };

      setSimulationToolMeshUrl(resolveBackendAssetUrl(simulation.toolMeshUrl));
      setSimulationFinalMeshUrl(resolveBackendAssetUrl(simulation.finalMeshUrl));

      if (!finalFrame) {
        updateSimulationActiveMeshUrl(null);
        updateSimulationCachedMeshUrl(null);
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
    if (!simulationId || simulationFrameCount === 0) {
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
  }, [applySimulationFrame, simulationFrameCount, simulationFrameIndex, simulationId, visibleSimulationFrames]);

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
      setOperationDraft(applySelectionToOperationDraft(operationDraft, selection, meshMaxZ));
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

  function handleSelectTreeNode(nodeId: string) {
    setSelectedTreeNodeId(nodeId);
    setSelectedOperationId(nodeId === "setup-1" || nodeId === "part" ? null : nodeId);
  }

  function handleDownloadOperationClData(operationId: string) {
    const operation = operations.find((item) => item.id === operationId);
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

    if (operationToGenerate.type === "parallel_finishing" && !cachedMeshVersion) {
      setRequestState("error");
      setRequestMessage("Wait for the part mesh to finish caching before generating parallel finishing.");
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
      simulationRequest.append("chunk_padding_x", String(CHUNK_PADDING_X));
      simulationRequest.append("chunk_padding_y", String(CHUNK_PADDING_Y));
      simulationRequest.append("chunk_padding_z", String(CHUNK_PADDING_Z));
      simulationRequest.append("chunk_step_distance", String(SIMULATION_CONTACT_STEP_DISTANCE));
      await appendFrontendCachedMesh(simulationRequest, meshUrl, meshName);

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
      setMeshUrl(localMesh.payload.dataUrl);
      setMeshMaxZ(localMesh.payload.maxZ ?? null);
      setMeshCacheState("ready");
      setMeshCacheMessage(
        localMesh.saved
          ? "Cached in browser localStorage. Caching backend memory..."
          : "Loaded in browser. Browser localStorage cache unavailable.",
      );

      try {
        const cachedMesh = await uploadMeshToBackend(file, file.name);
        if (meshUploadRequestRef.current !== requestId) {
          return;
        }

        setMeshMaxZ(cachedMesh.maxZ);
        setCachedMeshVersion(cachedMesh.version);
        setMeshCacheMessage(
          localMesh.saved
            ? "Cached in browser localStorage and backend memory."
            : "Loaded in browser and cached in backend memory.",
        );
      } catch (error: unknown) {
        if (meshUploadRequestRef.current !== requestId) {
          return;
        }

        console.error("Failed to cache STEP in backend", error);
        setMeshCacheMessage(
          localMesh.saved
            ? "Cached in browser localStorage. Backend cache unavailable."
            : "Loaded in browser. Backend cache unavailable.",
        );
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

          <SettingsDialog
            simulationDebugUiEnabled={simulationDebugUiEnabled}
            onSimulationDebugUiEnabledChange={setSimulationDebugUiEnabled}
            toolRenderMode={toolRenderMode}
            onToolRenderModeChange={setToolRenderMode}
            partRenderMode={partRenderMode}
            onPartRenderModeChange={setPartRenderMode}
            stockRenderMode={stockRenderMode}
            onStockRenderModeChange={setStockRenderMode}
            clearanceOffset={clearanceOffset}
            onClearanceOffsetChange={setClearanceOffset}
          />
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <AppSidebar
            meshLoaded={Boolean(meshUrl)}
            meshName={meshName}
            operations={operations}
            selectedNodeId={selectedTreeNodeId}
            simulatableOperationIds={simulatableOperationIds}
            comparableOperationIds={comparableOperationIds}
            downloadableOperationIds={downloadableOperationIds}
            generatingOperationId={generatingOperationId}
            generatingOperationProgressPercent={simulationProgressPercent}
            isToolpathGenerating={generatedOperation === null && requestState === "submitting"}
            isSimulationGenerating={generatedOperation !== null && requestState === "submitting"}
            onMeshUpload={handleMeshUpload}
            onAddOperation={handleAddOperation}
            onSelectNode={handleSelectTreeNode}
            onEditOperation={handleEditOperation}
            onRegenerateOperation={handleRegenerateOperation}
            onDeleteOperation={handleDeleteOperation}
            onSimulateOperation={handleSimulateOperation}
            onCompareOperation={handleCompareOperation}
            onDownloadOperationClData={handleDownloadOperationClData}
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

                <div className="pointer-events-auto absolute left-2 top-2 z-20 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow backdrop-blur">
                  <Button type="button" className="w-12" variant={showStock ? "outline" : "secondary"} onClick={() => setShowStock((current) => !current)} aria-pressed={showStock}>
                    Stock
                  </Button>
                  <Button type="button" className="w-12" variant={showPartMesh ? "outline" : "secondary"} onClick={() => setShowPartMesh((current) => !current)} aria-pressed={showPartMesh}>
                    Part
                  </Button>
                  <Button type="button" className="w-18" variant={showToolpaths ? "outline" : "secondary"} onClick={() => setShowToolpaths((current) => !current)} aria-pressed={showToolpaths}>
                    Toolpaths
                  </Button>
                  {isSimulationMode ? (
                    <Button type="button" className="w-12" variant={showTool ? "outline" : "secondary"} onClick={() => setShowTool((current) => !current)} aria-pressed={showTool}>
                      Tool
                    </Button>
                  ) : null}
                </div>

                <SimulationDebugOverlay
                  visible={simulationDebugUiEnabled && Boolean(simulationId)}
                  chunkIndex={simulationChunkIndex}
                  chunkCount={simulationChunkCount}
                  stepIndex={simulationChunkStepIndex}
                  stepCount={simulationChunkStepCount}
                  focusMeshRequestMs={simulationFocusMeshRequestMs}
                  chunkFetchMs={simulationChunkFetchMs}
                />

            {isSimulationMode && simulationId && simulationFrameCount > 0 ? (
              <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20">
                <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-3 rounded-md border bg-background/95 px-2 py-2 shadow">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={requestState === "submitting" || simulationFrameCount <= 1}
                    onClick={isSimulationPlaying ? handleSimulationPause : handleSimulationPlay}
                  >
                    {isSimulationPlaying ? "Pause" : "Play"}
                  </Button>

                  <Slider
                    min={0}
                    max={Math.max(simulationFrameCount - 1, 0)}
                    step={1}
                    value={[simulationFrameIndex]}
                    onValueChange={handleSimulationFrameChange}
                    disabled={requestState === "submitting"}
                    className="flex-1"
                  />

                  <div className="w-20">
                    <Slider
                      min={0}
                      max={SIMULATION_STRIDE_OPTIONS.length - 1}
                      step={1}
                      value={[simulationStrideOptionIndex(simulationStride)]}
                      onValueChange={handleSimulationStrideChange}
                    />
                  </div>

                  <div className="shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
                    Frame {simulationFrameIndex + 1} / {simulationFrameCount}
                  </div>

                  <Button type="button" variant="ghost" size="icon-xs" onClick={handleExitSimulation} aria-label="Exit simulation" title="Exit simulation">
                    <X />
                  </Button>
                </div>
              </div>
            ) : null}

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
