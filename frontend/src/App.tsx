import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppSidebar, type RequestState } from "@/components/app-sidebar";
import { meshBlobForBackend } from "@/components/polyline-viewer/mesh-export";
import { loadMeshGeometry } from "@/components/polyline-viewer/mesh-loader";
import { SettingsDialog } from "@/components/settings-dialog";
import { OperationDialog } from "@/components/operation-dialog";
import { OperationTypeDialog } from "@/components/operation-type-dialog";
import {
  PolylineViewer,
  type MeshFaceSelection,
  type PolylineDefinition,
  type PolylinePoint,
} from "@/components/polyline-viewer";
import { Button } from "t-components/button";
import { X } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { SidebarProvider, SidebarTrigger } from "t-components/sidebar";
import { getOpenCamBootstrap, sendRhinoUiDebug } from "@/bootstrap";
import type { DraftObject } from "@/lib/cam-schema";
import {
  applySelectionToPocketOperationDraft,
  buildGenerateToolpathRequest,
  createPocketOperationDraft,
  parsePocketOperationDraft,
  pocketOperationSchema,
} from "@/lib/cam-schema";
import { getBackendUrl } from "@/hooks/useBackendConnection";
import type { Pocketing2DOp as Operation } from "@/generated_schemas/cam";
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

type SweptSimulationResponse = {
  activeMeshUrl: string;
  cachedMeshUrl: string;
  simulationId: string;
  frameCount: number;
  chunkCount: number;
  chunkIndex: number;
  chunkStepIndex?: number | null;
  chunkStepCount?: number;
  chunkToolpathPoints?: ToolPositionResponse[];
  toolMeshUrl: string;
  toolPosition: ToolPositionResponse;
  rotateToolWithPath: boolean;
};

type SweptSimulationStartResponse = {
  taskId: string;
};

type SweptSimulationResampleRequest = {
  frameStepDistance: number;
};

type SweptSimulationStatusResponse = {
  taskId: string;
  status: "queued" | "running" | "cancelling" | "completed" | "cancelled" | "error";
  progressPercent: number;
  message?: string | null;
  errorDetail?: string | null;
  result?: SweptSimulationResponse | null;
};

type SweptSimulationFrameResponse = {
  activeMeshUrl: string;
  cachedMeshUrl: string;
  chunkIndex: number;
  chunkStepIndex?: number | null;
  chunkStepCount?: number;
  chunkToolpathPoints?: ToolPositionResponse[];
  toolPosition: ToolPositionResponse;
  rotateToolWithPath: boolean;
};

const CUT_PATH_COLOR = "#1d4ed8";
const CLEARANCE_PATH_COLOR = "#dc2626";
const POSITION_EPSILON = 1e-6;

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

type SweptSimulationFramesResponse = {
  startIndex: number;
  frames: SweptSimulationFrameResponse[];
};

type MeshCacheState = "idle" | "saving" | "ready" | "error";

type CachedMeshResponse = {
  name: string;
  meshUrl: string;
  maxZ: number;
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
const SIMULATION_FRAME_STEP_DISTANCE_MIN = 0.5;
const SIMULATION_FRAME_STEP_DISTANCE_MAX = 10;
const SIMULATION_FRAME_STEP_DISTANCE_STEP = 0.5;
const SIMULATION_FRAME_STEP_DISTANCE_DEFAULT = 5;
const SIMULATION_ROTATE_TOOL_WITH_PATH = false;
const SIMULATION_FRAME_BATCH_SIZE = 10;
const SIMULATION_SAMPLE_SPACING = 2;
const CHUNK_PADDING_X = 5;
const CHUNK_PADDING_Y = 5;
const CHUNK_PADDING_Z = 1;
const SIMULATION_PREFETCH_TRIGGER_FRAME_COUNT = Math.max(
  1,
  Math.ceil(SIMULATION_FRAME_BATCH_SIZE / 2),
);
const ENABLE_FRONTEND_FRAME_CACHE = false;

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

function getPolylineLength(points: ReadonlyArray<PolylinePoint>) {
  let total = 0;

  for (let index = 1; index < points.length; index += 1) {
    const [ax, ay, az] = points[index - 1];
    const [bx, by, bz] = points[index];
    total += Math.hypot(bx - ax, by - ay, bz - az);
  }

  return total;
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

function operationToMeshFaceSelections(operation: Operation | null): MeshFaceSelection[] {
  const cutAreas = operation?.driveGeometry?.cutAreas;
  const geometries = Array.isArray(cutAreas) ? cutAreas : cutAreas ? [cutAreas] : [];
  return geometries.map(geometryToMeshFaceSelection);
}

function draftToMeshFaceSelections(draft: DraftObject | null): MeshFaceSelection[] {
  const cutAreas = (draft?.driveGeometry as DraftObject | undefined)?.cutAreas;
  const geometries = Array.isArray(cutAreas) ? cutAreas : cutAreas ? [cutAreas] : [];

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

function clampSimulationFrameStepDistance(value: number | undefined) {
  return Math.max(
    SIMULATION_FRAME_STEP_DISTANCE_MIN,
    Math.min(
      Math.round((value ?? SIMULATION_FRAME_STEP_DISTANCE_DEFAULT) / SIMULATION_FRAME_STEP_DISTANCE_STEP)
        * SIMULATION_FRAME_STEP_DISTANCE_STEP,
      SIMULATION_FRAME_STEP_DISTANCE_MAX,
    ),
  );
}

function formatSimulationFrameStepDistance(value: number) {
  return `${value.toFixed(value % 1 === 0 ? 0 : 1)} mm`;
}

function App() {
  const [meshName, setMeshName] = useState<string | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [meshCacheState, setMeshCacheState] = useState<MeshCacheState>("idle");
  const [meshCacheMessage, setMeshCacheMessage] = useState<string>("");
  const meshUploadRequestRef = useRef(0);
  const meshRestoreAbortRef = useRef<AbortController | null>(null);
  const hasInitializedSidebarSettingsRef = useRef(false);
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);
  const [meshMaxZ, setMeshMaxZ] = useState<number | null>(null);
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
  const [simulationToolMeshUrl, setSimulationToolMeshUrl] = useState<string | null>(null);
  const [simulationToolPosition, setSimulationToolPosition] = useState<PolylinePoint | null>(null);
  const [simulationRotateToolWithPath, setSimulationRotateToolWithPath] = useState(false);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [simulationTaskId, setSimulationTaskId] = useState<string | null>(null);
  const [simulationProgressPercent, setSimulationProgressPercent] = useState(0);
  const [simulationFrameCount, setSimulationFrameCount] = useState(0);
  const [simulationChunkCount, setSimulationChunkCount] = useState(0);
  const [simulationChunkIndex, setSimulationChunkIndex] = useState<number | null>(null);
  const [simulationChunkStepIndex, setSimulationChunkStepIndex] = useState<number | null>(null);
  const [simulationChunkStepCount, setSimulationChunkStepCount] = useState(0);
  const [simulationFocusMeshRequestMs, setSimulationFocusMeshRequestMs] = useState<number | null>(null);
  const [simulationChunkFetchMs, setSimulationChunkFetchMs] = useState<number | null>(null);
  const [simulationChunkToolpathPoints, setSimulationChunkToolpathPoints] = useState<PolylinePoint[]>([]);
  const [simulationFrameIndex, setSimulationFrameIndex] = useState(0);
  const [simulationFrameStepDistance, setSimulationFrameStepDistance] = useState(
    SIMULATION_FRAME_STEP_DISTANCE_DEFAULT,
  );
  const [displayedSimulationFrameIndex, setDisplayedSimulationFrameIndex] = useState<number | null>(null);
  const [isSimulationPlaying, setIsSimulationPlaying] = useState(false);
  const loadedSimulationFrameRef = useRef<{
    simulationId: string | null;
    frameIndex: number | null;
  }>({
    simulationId: null,
    frameIndex: null,
  });
  const simulationFrameRequestTokenRef = useRef(0);
  const simulationFrameDisplayRequestRef = useRef(0);
  const queuedGenerationOperationsRef = useRef<Operation[]>([]);
  const currentGenerationLabelRef = useRef("2D Pocket");
  const simulationFrameCacheRef = useRef<Map<number, SweptSimulationFrameResponse>>(new Map());
  const simulationChunkMeshCacheRef = useRef<Map<number, string>>(new Map());
  const simulationChunkMeshRequestCacheRef = useRef<Map<number, Promise<{ objectUrl: string; elapsedMs: number }>>>(new Map());
  const simulationFrameRequestCacheRef = useRef<Map<string, Promise<void>>>(new Map());
  const simulationFramePrefetchTriggerRef = useRef<{
    simulationId: string | null;
    frameIndex: number | null;
  }>({
    simulationId: null,
    frameIndex: null,
  });
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [requestMessage, setRequestMessage] = useState<string>("");
  const [isSimulationMode, setIsSimulationMode] = useState(false);
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
  useEffect(() => {
    if (!simulationId) {
      setIsSimulationMode(false);
    }
  }, [simulationId]);

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
          await uploadLocalStorageMeshToBackend(localMesh, restoreController.signal);
          if (!cancelled && meshUploadRequestRef.current === requestId) {
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
    loadedSimulationFrameRef.current = {
      simulationId: null,
      frameIndex: null,
    };
    simulationFrameRequestTokenRef.current += 1;
    simulationFrameDisplayRequestRef.current += 1;
    simulationFrameCacheRef.current.forEach((frame) => {
      if (frame.activeMeshUrl.startsWith("blob:")) {
        URL.revokeObjectURL(frame.activeMeshUrl);
      }
    });
    simulationFrameCacheRef.current.clear();
    simulationChunkMeshCacheRef.current.forEach((objectUrl) => {
      if (objectUrl.startsWith("blob:")) {
        URL.revokeObjectURL(objectUrl);
      }
    });
    simulationChunkMeshCacheRef.current.clear();
    if (simulationActiveMeshUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(simulationActiveMeshUrl);
    }
    if (simulationCachedMeshUrl?.startsWith("blob:")) {
      URL.revokeObjectURL(simulationCachedMeshUrl);
    }
    simulationChunkMeshRequestCacheRef.current.clear();
    simulationFrameRequestCacheRef.current.clear();
    simulationFramePrefetchTriggerRef.current = {
      simulationId: null,
      frameIndex: null,
    };
    setSimulationActiveMeshUrl(null);
    setSimulationCachedMeshUrl(null);
    setSimulationToolMeshUrl(null);
    setSimulationToolPosition(null);
    setSimulationRotateToolWithPath(false);
    setSimulationId(null);
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
    setSimulationFrameIndex(0);
    setDisplayedSimulationFrameIndex(null);
    setIsSimulationPlaying(false);
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
    () => sampleOperationRecords(generatedRecords, SIMULATION_SAMPLE_SPACING),
    [generatedRecords],
  );
  const simulationToolRotation = useMemo(() => {
    if (!simulationRotateToolWithPath || !simulationId || !isSimulationMode || simulationSamples.length === 0) {
      return null;
    }

    const sampleIndex = Math.min(Math.max(simulationFrameIndex, 0), simulationSamples.length - 1);
    const sample = simulationSamples[sampleIndex] ?? null;
    const previousSample = sampleIndex > 0 ? simulationSamples[sampleIndex - 1] : null;
    const nextSample = sampleIndex + 1 < simulationSamples.length ? simulationSamples[sampleIndex + 1] : null;

    if (!sample) {
      return null;
    }

    for (const [dx, dy] of [
      previousSample ? [sample.x - previousSample.x, sample.y - previousSample.y] : null,
      nextSample ? [nextSample.x - sample.x, nextSample.y - sample.y] : null,
    ].filter((value): value is [number, number] => value !== null)) {
      if (Math.hypot(dx, dy) <= POSITION_EPSILON) {
        continue;
      }
      return Math.atan2(dy, dx);
    }

    return null;
  }, [isSimulationMode, simulationFrameIndex, simulationId, simulationRotateToolWithPath, simulationSamples]);
  const secondaryMeshUrl = isSimulationMode ? simulationCachedMeshUrl : null;
  const tertiaryMeshUrl = isSimulationMode ? simulationActiveMeshUrl : null;
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

  const generatedPathLength = useMemo(() => {
    return operationPolylines.reduce(
      (total, polyline) => total + getPolylineLength(polyline.points),
      0,
    );
  }, [operationPolylines]);

  const generatedPathPointCount = generatedRecords.length;

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  );
  const simulatableOperationIds = useMemo(
    () => simulationId && selectedOperationId ? new Set([selectedOperationId]) : new Set<string>(),
    [selectedOperationId, simulationId],
  );

  const highlightedMeshFaces = useMemo(() => {
    if (isOperationDialogOpen || faceSelectionMode) {
      return draftToMeshFaceSelections(operationDraft);
    }

    return visibleOperations.flatMap(operationToMeshFaceSelections);
  }, [faceSelectionMode, isOperationDialogOpen, operationDraft, visibleOperations]);

  const meshStatusLabel = meshName ?? "No STEP loaded.";
  const meshCacheStatusLabel =
    meshCacheState === "saving" ? "Caching STEP in backend..." : meshCacheMessage;

  const fetchChunkMesh = useCallback(async (nextSimulationId: string, chunkIndex: number) => {
    const cachedMesh = simulationChunkMeshCacheRef.current.get(chunkIndex);
    if (cachedMesh) {
      return { objectUrl: cachedMesh, elapsedMs: 0 };
    }

    const inFlightRequest = simulationChunkMeshRequestCacheRef.current.get(chunkIndex);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const request = prefetchMeshObjectUrlWithTiming(
      `/simulate/${nextSimulationId}/chunks/${chunkIndex}/cached-mesh.glb`,
      ENABLE_FRONTEND_FRAME_CACHE ? "default" : "no-store",
    )
      .then((result) => {
        simulationChunkMeshCacheRef.current.set(chunkIndex, result.objectUrl);
        return result;
      })
      .finally(() => {
        simulationChunkMeshRequestCacheRef.current.delete(chunkIndex);
      });

    simulationChunkMeshRequestCacheRef.current.set(chunkIndex, request);
    return request;
  }, []);

  const prefetchAdjacentChunkMeshes = useCallback(
    (nextSimulationId: string, chunkIndex: number, chunkCount: number) => {
      if (!ENABLE_FRONTEND_FRAME_CACHE) {
        return;
      }

      for (const neighborIndex of [chunkIndex - 1, chunkIndex + 1]) {
        if (neighborIndex < 0 || neighborIndex >= chunkCount) {
          continue;
        }

        void fetchChunkMesh(nextSimulationId, neighborIndex).catch((error: unknown) => {
          console.error("Failed to prefetch adjacent chunk mesh", error);
        });
      }
    },
    [fetchChunkMesh],
  );

  const applySimulationFrame = useCallback(
    async (
      nextSimulationId: string,
      frameIndex: number,
      frame: SweptSimulationFrameResponse,
      chunkCount: number,
      shouldApply: () => boolean = () => true,
    ) => {
      const focusMeshRequest = ENABLE_FRONTEND_FRAME_CACHE
        ? { objectUrl: frame.activeMeshUrl, elapsedMs: 0 }
        : await prefetchMeshObjectUrlWithTiming(frame.activeMeshUrl, "no-store");
      const activeMeshUrl = focusMeshRequest.objectUrl;
      const chunkMeshRequest = await fetchChunkMesh(nextSimulationId, frame.chunkIndex);
      const cachedMeshUrl = chunkMeshRequest.objectUrl;
      if (!shouldApply()) {
        if (!ENABLE_FRONTEND_FRAME_CACHE && activeMeshUrl.startsWith("blob:")) {
          URL.revokeObjectURL(activeMeshUrl);
        }
        return false;
      }

      if (!ENABLE_FRONTEND_FRAME_CACHE) {
        if (simulationActiveMeshUrl?.startsWith("blob:") && simulationActiveMeshUrl !== activeMeshUrl) {
          URL.revokeObjectURL(simulationActiveMeshUrl);
        }
      }

      loadedSimulationFrameRef.current = {
        simulationId: nextSimulationId,
        frameIndex,
      };
      setDisplayedSimulationFrameIndex(frameIndex);
      setSimulationActiveMeshUrl(activeMeshUrl);
      setSimulationCachedMeshUrl(cachedMeshUrl);
      setSimulationChunkIndex(frame.chunkIndex);
      setSimulationChunkStepIndex(frame.chunkStepIndex ?? null);
      setSimulationChunkStepCount(frame.chunkStepCount ?? 0);
      setSimulationFocusMeshRequestMs(focusMeshRequest.elapsedMs);
      setSimulationChunkFetchMs(chunkMeshRequest.elapsedMs);
      setSimulationChunkToolpathPoints((frame.chunkToolpathPoints ?? []).map(toolPositionToPoint));
      setSimulationToolPosition(toolPositionToPoint(frame.toolPosition));
      setSimulationRotateToolWithPath(frame.rotateToolWithPath);
      prefetchAdjacentChunkMeshes(nextSimulationId, frame.chunkIndex, chunkCount);
      return true;
    },
    [fetchChunkMesh, prefetchAdjacentChunkMeshes, simulationActiveMeshUrl, simulationCachedMeshUrl],
  );

  const fetchSimulationFrameBatch = useCallback(
    async (
      nextSimulationId: string,
      startFrameIndex: number,
      count: number,
      totalFrameCount: number,
    ) => {
      if (!ENABLE_FRONTEND_FRAME_CACHE) {
        return;
      }

      if (count <= 0 || startFrameIndex < 0 || startFrameIndex >= totalFrameCount) {
        return;
      }

      const endFrameIndex = Math.min(startFrameIndex + count - 1, totalFrameCount - 1);
      let hasMissingFrame = false;

      for (let frameIndex = startFrameIndex; frameIndex <= endFrameIndex; frameIndex += 1) {
        if (!simulationFrameCacheRef.current.has(frameIndex)) {
          hasMissingFrame = true;
          break;
        }
      }

      if (!hasMissingFrame) {
        return;
      }

      const requestKey = `${startFrameIndex}:${endFrameIndex}`;
      const cachedRequest = simulationFrameRequestCacheRef.current.get(requestKey);
      if (cachedRequest) {
        await cachedRequest;
        return;
      }

      const requestToken = simulationFrameRequestTokenRef.current;
      const request = (async () => {
        const response = await fetch(
          `${getBackendUrl()}/simulate/${nextSimulationId}/frames?start_index=${startFrameIndex}&count=${endFrameIndex - startFrameIndex + 1}`,
        );

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { detail?: string };
            throw new Error(payload.detail ?? "Failed to load simulation frames.");
          }

          const detail = await response.text();
          throw new Error(detail || "Failed to load simulation frames.");
        }

        const payload = (await response.json()) as SweptSimulationFramesResponse;
        if (simulationFrameRequestTokenRef.current !== requestToken) {
          return;
        }

        const prefetchedFrames = await Promise.all(
          payload.frames.map(async (frame, index) => {
            const frameIndex = payload.startIndex + index;
            const cachedFrame = simulationFrameCacheRef.current.get(frameIndex);
            if (cachedFrame) {
              return {
                frameIndex,
                frame: cachedFrame,
                createdMeshUrl: null,
              };
            }

            const activeMeshUrl = await prefetchMeshObjectUrl(frame.activeMeshUrl);
            return {
              frameIndex,
              frame: {
                ...frame,
                activeMeshUrl,
              },
              createdMeshUrl: activeMeshUrl,
            };
          }),
        );

        if (simulationFrameRequestTokenRef.current !== requestToken) {
          prefetchedFrames.forEach(({ createdMeshUrl }) => {
            if (createdMeshUrl) {
              URL.revokeObjectURL(createdMeshUrl);
            }
          });
          return;
        }

        prefetchedFrames.forEach(({ frameIndex, frame, createdMeshUrl }) => {
          if (simulationFrameCacheRef.current.has(frameIndex)) {
            if (createdMeshUrl) {
              URL.revokeObjectURL(createdMeshUrl);
            }
            return;
          }

          simulationFrameCacheRef.current.set(frameIndex, frame);
        });
      })();

      simulationFrameRequestCacheRef.current.set(requestKey, request);

      try {
        await request;
      } finally {
        simulationFrameRequestCacheRef.current.delete(requestKey);
      }
    },
    [],
  );

  const updateSimulationPrefetchTrigger = useCallback(
    (nextSimulationId: string, frameIndex: number | null) => {
      simulationFramePrefetchTriggerRef.current = {
        simulationId: nextSimulationId,
        frameIndex,
      };
    },
    [],
  );

  const fetchSimulationFrame = useCallback(
    async (nextSimulationId: string, frameIndex: number, frameCount: number) => {
      if (!ENABLE_FRONTEND_FRAME_CACHE) {
        const response = await fetch(
          `${getBackendUrl()}/simulate/${nextSimulationId}/frames?start_index=${frameIndex}&count=1`,
          { cache: "no-store" },
        );

        if (!response.ok) {
          const contentType = response.headers.get("content-type") ?? "";
          if (contentType.includes("application/json")) {
            const payload = (await response.json()) as { detail?: string };
            throw new Error(payload.detail ?? "Failed to load simulation frame.");
          }

          const detail = await response.text();
          throw new Error(detail || "Failed to load simulation frame.");
        }

        const payload = (await response.json()) as SweptSimulationFramesResponse;
        return payload.frames[0] ?? null;
      }

      const cachedFrame = simulationFrameCacheRef.current.get(frameIndex);
      if (cachedFrame) {
        return cachedFrame;
      }

      const batchCount = Math.min(SIMULATION_FRAME_BATCH_SIZE, frameCount - frameIndex);
      const endFrameIndex = frameIndex + batchCount - 1;

      await fetchSimulationFrameBatch(
        nextSimulationId,
        frameIndex,
        batchCount,
        frameCount,
      );

      const frame = simulationFrameCacheRef.current.get(frameIndex) ?? null;
      if (frame) {
        updateSimulationPrefetchTrigger(nextSimulationId, endFrameIndex);
      }

      return frame;
    },
    [fetchSimulationFrameBatch, updateSimulationPrefetchTrigger],
  );

  const prefetchSimulationFrames = useCallback(
    (nextSimulationId: string, frameIndex: number, frameCount: number) => {
      if (!ENABLE_FRONTEND_FRAME_CACHE || frameIndex >= frameCount - 1) {
        return;
      }

      const prefetchTrigger = simulationFramePrefetchTriggerRef.current;
      const bufferedUntilFrameIndex =
        prefetchTrigger.simulationId === nextSimulationId ? prefetchTrigger.frameIndex : null;
      const remainingBufferedFrameCount =
        bufferedUntilFrameIndex == null ? 0 : bufferedUntilFrameIndex - frameIndex;

      if (remainingBufferedFrameCount > SIMULATION_PREFETCH_TRIGGER_FRAME_COUNT) {
        return;
      }

      const prefetchStartFrameIndex = Math.max(
        frameIndex + 1,
        (bufferedUntilFrameIndex ?? frameIndex) + 1,
      );
      if (prefetchStartFrameIndex >= frameCount) {
        return;
      }

      const prefetchCount = Math.min(
        SIMULATION_FRAME_BATCH_SIZE,
        frameCount - prefetchStartFrameIndex,
      );
      const nextBufferedUntilFrameIndex = prefetchStartFrameIndex + prefetchCount - 1;

      updateSimulationPrefetchTrigger(nextSimulationId, nextBufferedUntilFrameIndex);
      void fetchSimulationFrameBatch(
        nextSimulationId,
        prefetchStartFrameIndex,
        prefetchCount,
        frameCount,
      ).catch((error: unknown) => {
        console.error("Failed to prefetch simulation frames", error);
        updateSimulationPrefetchTrigger(nextSimulationId, bufferedUntilFrameIndex);
      });
    },
    [fetchSimulationFrameBatch, updateSimulationPrefetchTrigger],
  );

  const loadSimulationFrame = useCallback(
    async (
      nextSimulationId: string,
      frameIndex: number,
      frameCount: number,
      requestId: number,
    ) => {
      const frame = await fetchSimulationFrame(nextSimulationId, frameIndex, frameCount);
      if (!frame || simulationFrameDisplayRequestRef.current !== requestId) {
        return;
      }

      const applied = await applySimulationFrame(
        nextSimulationId,
        frameIndex,
        frame,
        simulationChunkCount,
        () => simulationFrameDisplayRequestRef.current === requestId,
      );
      if (applied) {
        prefetchSimulationFrames(nextSimulationId, frameIndex, frameCount);
      }
    },
    [applySimulationFrame, fetchSimulationFrame, prefetchSimulationFrames, simulationChunkCount],
  );

  const applyCompletedSimulation = useCallback(
    async (simulation: SweptSimulationResponse, nextIsSimulationMode = false) => {
      const finalFrameIndex = Math.max(simulation.frameCount - 1, 0);
      const focusMeshRequest = await prefetchMeshObjectUrlWithTiming(
        simulation.activeMeshUrl,
        ENABLE_FRONTEND_FRAME_CACHE ? "default" : "no-store",
      );
      const finalFrame: SweptSimulationFrameResponse = {
        activeMeshUrl: focusMeshRequest.objectUrl,
        cachedMeshUrl: simulation.cachedMeshUrl,
        chunkIndex: simulation.chunkIndex,
        chunkStepIndex: simulation.chunkStepIndex,
        chunkStepCount: simulation.chunkStepCount,
        chunkToolpathPoints: simulation.chunkToolpathPoints,
        toolPosition: simulation.toolPosition,
        rotateToolWithPath: simulation.rotateToolWithPath,
      };
      const chunkMeshRequest = await prefetchMeshObjectUrlWithTiming(
        simulation.cachedMeshUrl,
        ENABLE_FRONTEND_FRAME_CACHE ? "default" : "no-store",
      );
      const cachedChunkMeshUrl = chunkMeshRequest.objectUrl;

      if (ENABLE_FRONTEND_FRAME_CACHE) {
        simulationFrameCacheRef.current.set(finalFrameIndex, finalFrame);
      }
      simulationChunkMeshCacheRef.current.set(simulation.chunkIndex, cachedChunkMeshUrl);

      loadedSimulationFrameRef.current = {
        simulationId: simulation.simulationId,
        frameIndex: finalFrameIndex,
      };
      setDisplayedSimulationFrameIndex(finalFrameIndex);
      setSimulationToolMeshUrl(resolveBackendAssetUrl(simulation.toolMeshUrl));
      setSimulationToolPosition(toolPositionToPoint(simulation.toolPosition));
      setSimulationId(simulation.simulationId);
      setSimulationRotateToolWithPath(simulation.rotateToolWithPath);
      setSimulationFrameCount(simulation.frameCount);
      setSimulationChunkCount(simulation.chunkCount);
      setSimulationChunkIndex(simulation.chunkIndex);
      setSimulationChunkStepIndex(simulation.chunkStepIndex ?? null);
      setSimulationChunkStepCount(simulation.chunkStepCount ?? 0);
      setSimulationFocusMeshRequestMs(focusMeshRequest.elapsedMs);
      setSimulationChunkFetchMs(chunkMeshRequest.elapsedMs);
      setSimulationChunkToolpathPoints((simulation.chunkToolpathPoints ?? []).map(toolPositionToPoint));
      setSimulationFrameIndex(finalFrameIndex);
      setIsSimulationPlaying(false);
      setSimulationActiveMeshUrl(finalFrame.activeMeshUrl);
      setSimulationCachedMeshUrl(cachedChunkMeshUrl);
      if (ENABLE_FRONTEND_FRAME_CACHE && simulation.frameCount > 0) {
        const initialPrefetchCount = Math.min(SIMULATION_FRAME_BATCH_SIZE, simulation.frameCount);
        updateSimulationPrefetchTrigger(simulation.simulationId, initialPrefetchCount - 1);
        void fetchSimulationFrameBatch(
          simulation.simulationId,
          0,
          initialPrefetchCount,
          simulation.frameCount,
        ).catch((error: unknown) => {
          console.error("Failed to prefetch initial simulation frames", error);
          updateSimulationPrefetchTrigger(simulation.simulationId, null);
        });
      }
      setIsSimulationMode(nextIsSimulationMode);
      prefetchAdjacentChunkMeshes(
        simulation.simulationId,
        simulation.chunkIndex,
        simulation.chunkCount,
      );
    },
    [fetchSimulationFrameBatch, prefetchAdjacentChunkMeshes, updateSimulationPrefetchTrigger],
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
      prefetchSimulationFrames(simulationId, simulationFrameIndex, simulationFrameCount);
      return undefined;
    }

    let cancelled = false;
    const requestId = simulationFrameDisplayRequestRef.current + 1;
    simulationFrameDisplayRequestRef.current = requestId;

    void loadSimulationFrame(simulationId, simulationFrameIndex, simulationFrameCount, requestId).catch((error: unknown) => {
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
  }, [loadSimulationFrame, prefetchSimulationFrames, simulationFrameCount, simulationFrameIndex, simulationId]);

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
          const frame = await fetchSimulationFrame(simulationId, nextFrameIndex, simulationFrameCount);
          if (!frame || cancelled) {
            return;
          }

          const applied = await applySimulationFrame(
            simulationId,
            nextFrameIndex,
            frame,
            simulationChunkCount,
            () => !cancelled,
          );
          if (!applied || cancelled) {
            return;
          }

          setSimulationFrameIndex(nextFrameIndex);
          prefetchSimulationFrames(simulationId, nextFrameIndex, simulationFrameCount);
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
    fetchSimulationFrame,
    isSimulationPlaying,
    prefetchSimulationFrames,
    simulationChunkCount,
    simulationFrameCount,
    simulationFrameIndex,
    simulationId,
  ]);

  function resetGeneratedPreview() {
    setGeneratedOperation(null);
    setSimulationActiveMeshUrl(null);
    setSimulationCachedMeshUrl(null);
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
      setOperationDraft(applySelectionToPocketOperationDraft(operationDraft, selection, meshMaxZ));
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

  function handleAddPocketOperation() {
    if (!meshUrl) {
      setRequestState("error");
      setRequestMessage("Upload a STEP file before adding a pocket operation.");
      return;
    }

    setIsOperationTypeDialogOpen(false);
    setOperationDialogMode("create");
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(createPocketOperationDraft(operations.length + 1, null, meshMaxZ));
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
    setOperationDraft(createPocketOperationDraft(operationIndex + 1, null, meshMaxZ, operation));
    setIsOperationDialogOpen(true);
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
      const parsedOperation = parsePocketOperationDraft(operationDraft);
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
    setSelectedOperationId(nodeId === "setup-1" ? null : nodeId);
  }

  function handleSimulateOperation(operationId: string) {
    setSelectedTreeNodeId(operationId);
    setSelectedOperationId(operationId);

    if (!simulationId || simulationFrameCount === 0 || operationId !== selectedOperationId) {
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

    setIsSimulationMode(true);
  }

  function handleExitSimulation() {
    setIsSimulationPlaying(false);
    setIsSimulationMode(false);
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
    setIsSimulationMode(true);
    setSimulationFrameIndex(nextFrameIndex);
  }

  function handleSimulationPlay() {
    if (!simulationId || simulationFrameCount === 0) {
      return;
    }

    setIsSimulationMode(true);
    setSimulationFrameIndex((current) =>
      current >= simulationFrameCount - 1 && simulationFrameCount > 1 ? 0 : current,
    );
    setIsSimulationPlaying(true);
  }

  function handleSimulationFrameStepDistanceChange(values: number[]) {
    setSimulationFrameStepDistance(clampSimulationFrameStepDistance(values[0]));
  }

  async function handleSimulationFrameStepDistanceCommit(values: number[]) {
    const nextStepDistance = clampSimulationFrameStepDistance(values[0]);

    if (!simulationId || requestState === "submitting") {
      return;
    }

    const currentSimulationId = simulationId;
    const currentFrameProgress =
      simulationFrameCount > 1 ? simulationFrameIndex / (simulationFrameCount - 1) : 0;

    try {
      setIsSimulationPlaying(false);
      setRequestState("submitting");
      setRequestMessage(`Updating simulation step to ${formatSimulationFrameStepDistance(nextStepDistance)}...`);

      const response = await fetch(`${getBackendUrl()}/simulate/${currentSimulationId}/resample`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          frameStepDistance: nextStepDistance,
        } satisfies SweptSimulationResampleRequest),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") ?? "";
        if (contentType.includes("application/json")) {
          const payload = (await response.json()) as { detail?: string };
          throw new Error(payload.detail ?? "Failed to update simulation step.");
        }

        const detail = await response.text();
        throw new Error(detail || "Failed to update simulation step.");
      }

      const simulation = (await response.json()) as SweptSimulationResponse;
      const nextFrameIndex = Math.max(
        0,
        Math.min(
          Math.round(currentFrameProgress * Math.max(simulation.frameCount - 1, 0)),
          Math.max(simulation.frameCount - 1, 0),
        ),
      );

      resetSimulationPlaybackState();
      await applyCompletedSimulation(simulation, true);
      setSimulationFrameIndex(nextFrameIndex);
      setRequestState("success");
      setRequestMessage(`Simulation step updated to ${formatSimulationFrameStepDistance(nextStepDistance)}.`);
    } catch (error) {
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to update simulation step.",
      );
    }
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
          setSimulationProgressPercent(100);
          await applyCompletedSimulation(status.result);

          const nextQueuedOperation = queuedGenerationOperationsRef.current.shift() ?? null;
          if (nextQueuedOperation) {
            void handleGenerateOperation(nextQueuedOperation);
            return;
          }

          setRequestState("success");
          setRequestMessage(
            `${currentGenerationLabelRef.current} toolpaths generated and chunked swept simulation completed.`,
          );
          return;
        }

        if (status.status === "cancelled") {
          queuedGenerationOperationsRef.current = [];
          setSimulationTaskId(null);
          setSimulationProgressPercent(0);
          setSimulationActiveMeshUrl(null);
          setSimulationCachedMeshUrl(null);
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
        setSimulationTaskId(null);
        setSimulationProgressPercent(0);
        setSimulationActiveMeshUrl(null);
        setSimulationCachedMeshUrl(null);
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

    try {
      const requestBody = buildGenerateToolpathRequest(operationToGenerate, meshMaxZ);
      const nextOperationLabel = operationToGenerate.displayName ?? "2D Pocket";

      currentGenerationLabelRef.current = nextOperationLabel;
      setGeneratedOperation(null);
      if (operationToGenerate.id) {
        setGeneratedOperationsById((current) => {
          const next = { ...current };
          delete next[operationToGenerate.id!];
          return next;
        });
      }
      setSimulationActiveMeshUrl(null);
      setSimulationCachedMeshUrl(null);
      resetSimulationPlaybackState();
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
      simulationRequest.append("chunk_step_distance", String(SIMULATION_FRAME_STEP_DISTANCE_MIN));
      simulationRequest.append("frame_step_distance", String(simulationFrameStepDistance));
      simulationRequest.append("rotate_tool_with_path", String(SIMULATION_ROTATE_TOOL_WITH_PATH));
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
      setGeneratedOperation(null);
      setSimulationActiveMeshUrl(null);
      setSimulationCachedMeshUrl(null);
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
    setSelectedMeshFace(null);
    setOperations([]);
    setSelectedOperationId(null);
    setSelectedTreeNodeId("setup-1");
    setGeneratedOperation(null);
    setGeneratedOperationsById({});
    setSimulationActiveMeshUrl(null);
    setSimulationCachedMeshUrl(null);
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
          />
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <AppSidebar
            meshLoaded={Boolean(meshUrl)}
            meshStatusLabel={meshStatusLabel}
            meshCacheStatusLabel={meshCacheStatusLabel}
            operations={operations}
            selectedNodeId={selectedTreeNodeId}
            requestState={requestState}
            requestMessage={requestMessage}
            generatedPathCount={generatedRecords.length}
            generatedPathPointCount={generatedPathPointCount}
            generatedPathLength={generatedPathLength}
            simulatableOperationIds={simulatableOperationIds}
            onMeshUpload={handleMeshUpload}
            onAddOperation={handleAddOperation}
            onSelectNode={handleSelectTreeNode}
            onEditOperation={handleEditOperation}
            onDeleteOperation={handleDeleteOperation}
            onSimulateOperation={handleSimulateOperation}
            canManageOperations={requestState !== "submitting"}
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
                  meshOpacity={showPartMesh && showStock && isSimulationMode ? 0.3 : 1}
                  showMesh={showPartMesh}
                  showSecondaryMesh={showStock && isSimulationMode}
                  showTertiaryMesh={showStock && isSimulationMode}
                  showSimulationStock={showStock && !isSimulationMode}
                  showTool={showTool && isSimulationMode}
                  polylines={showToolpaths ? viewportPolylines : []}
                  faceSelectionMode={faceSelectionMode}
                  selectedMeshFace={null}
                  selectedMeshFaces={highlightedMeshFaces}
                  simulationTool={generatedOperation?.tool ?? null}
                  simulationSamples={simulationSamples}
                  simulationStep={isSimulationMode ? simulationFrameIndex : 0}
                  simulationToolMeshUrl={simulationToolMeshUrl}
                  simulationToolPosition={simulationToolPosition}
                  simulationToolRotation={simulationToolRotation}
                  simulationToolRotationEnabled={simulationRotateToolWithPath}
                  showOriginalMesh={!isSimulationMode}
                  onMeshFaceSelect={handleMeshFaceSelect}
                  className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none"
                />

                <div className="pointer-events-auto absolute left-4 top-4 z-20 flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow backdrop-blur">
                  <Button type="button" className="w-12" variant={showStock ? "outline" : "secondary"} onClick={() => setShowStock((current) => !current)} aria-pressed={showStock}>
                    Stock
                  </Button>
                  <Button type="button" className="w-12" variant={showPartMesh ? "outline" : "secondary"} onClick={() => setShowPartMesh((current) => !current)} aria-pressed={showPartMesh}>
                    Part
                  </Button>
                  <Button type="button" className="w-18" variant={showToolpaths ? "outline" : "secondary"} onClick={() => setShowToolpaths((current) => !current)} aria-pressed={showToolpaths}>
                    Toolpaths
                  </Button>
                  <Button type="button" className="w-12" variant={showTool ? "outline" : "secondary"} onClick={() => setShowTool((current) => !current)} aria-pressed={showTool}>
                    Tool
                  </Button>
                </div>

                {simulationDebugUiEnabled && simulationId ? (
              <div className="pointer-events-none absolute left-4 top-16 z-20 rounded-md border bg-background/90 p-2 text-xs shadow backdrop-blur">
                <div className="mb-1 font-medium">Simulation debug</div>
                <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 tabular-nums">
                  <span className="text-muted-foreground">Chunk</span>
                  <span>{simulationChunkIndex == null ? "—" : `${simulationChunkIndex + 1} / ${simulationChunkCount || "?"}`}</span>
                  <span className="text-muted-foreground">Step</span>
                  <span>{simulationChunkStepIndex == null ? "—" : `${simulationChunkStepIndex + 1} / ${simulationChunkStepCount || "?"}`}</span>
                  <span className="text-muted-foreground">Focus request</span>
                  <span>{simulationFocusMeshRequestMs == null ? "—" : `${simulationFocusMeshRequestMs.toFixed(0)} ms`}</span>
                  <span className="text-muted-foreground">Chunk fetch</span>
                  <span>{simulationChunkFetchMs == null ? "—" : `${simulationChunkFetchMs.toFixed(0)} ms`}</span>
                </div>
              </div>
            ) : null}

            {isSimulationMode && simulationId && simulationFrameCount > 0 ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20">
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

                  <div className="flex w-48 items-center gap-2">
                    <span className="text-xs text-muted-foreground">Step</span>
                    <Slider
                      min={SIMULATION_FRAME_STEP_DISTANCE_MIN}
                      max={SIMULATION_FRAME_STEP_DISTANCE_MAX}
                      step={SIMULATION_FRAME_STEP_DISTANCE_STEP}
                      value={[simulationFrameStepDistance]}
                      onValueChange={handleSimulationFrameStepDistanceChange}
                      onValueCommit={handleSimulationFrameStepDistanceCommit}
                      disabled={requestState === "submitting"}
                      className="flex-1"
                    />
                    <span className="w-14 text-right text-xs tabular-nums text-muted-foreground">
                      {formatSimulationFrameStepDistance(simulationFrameStepDistance)}
                    </span>
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
          </main>
        </div>

        <OperationTypeDialog
          open={isOperationTypeDialogOpen}
          onOpenChange={setIsOperationTypeDialogOpen}
          onSelectPocketing={handleAddPocketOperation}
        />

        <OperationDialog
          open={isOperationDialogOpen}
          draft={operationDraft}
          mode={operationDialogMode}
          rootSchema={pocketOperationSchema}
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
