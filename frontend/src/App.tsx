import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import { AppSidebar, type RequestState } from "@/components/app-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import { OperationDialog } from "@/components/operation-dialog";
import {
  PolylineViewer,
  type MeshFaceSelection,
  type PolylineDefinition,
  type PolylinePoint,
} from "@/components/polyline-viewer";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
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
import type { Pocket2DOperationConfig } from "@/generated/cam-types";
import { sampleToolpathLocations, type ToolpathOperation } from "@/simulation/toolpath";

type GeneratedPathResponse = ToolpathOperation["paths"][number];
type GeneratedOperationResponse = ToolpathOperation;
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
  toolMeshUrl: string;
  toolPosition: ToolPositionResponse;
};

type SweptSimulationStartResponse = {
  taskId: string;
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
  toolPosition: ToolPositionResponse;
};

const CUT_PATH_COLOR = "#1d4ed8";
const CLEARANCE_PATH_COLOR = "#dc2626";
const POSITION_EPSILON = 1e-6;

function areHeightsEqual(left: number, right: number) {
  return Math.abs(left - right) <= POSITION_EPSILON;
}

function createDisplayPolylinesForPath(path: GeneratedPathResponse): PolylineDefinition[] {
  const pathName = path.name ?? (path.kind === "clearance" ? "Clearance move" : "Generated profile");

  if (path.locations.length < 2) {
    return [
      {
        id: path.id,
        name: pathName,
        color: path.kind === "clearance" ? CLEARANCE_PATH_COLOR : CUT_PATH_COLOR,
        kind: path.kind,
        points: path.locations.map(({ x, y, z }) => [x, y, z] as const),
      },
    ];
  }

  if (path.kind !== "clearance") {
    return [
      {
        id: path.id,
        name: pathName,
        color: CUT_PATH_COLOR,
        kind: path.kind,
        points: path.locations.map(({ x, y, z }) => [x, y, z] as const),
      },
    ];
  }

  const clearanceZ = path.locations.reduce(
    (maxZ, location) => Math.max(maxZ, location.z),
    -Infinity,
  );

  const segments: PolylineDefinition[] = [];
  let currentPoints: PolylinePoint[] = [];
  let currentColor: string | null = null;

  for (let index = 1; index < path.locations.length; index += 1) {
    const start = path.locations[index - 1];
    const end = path.locations[index];
    const isPureClearanceSegment =
      areHeightsEqual(start.z, clearanceZ) && areHeightsEqual(end.z, clearanceZ);
    const segmentColor = isPureClearanceSegment ? CLEARANCE_PATH_COLOR : CUT_PATH_COLOR;
    const startPoint = [start.x, start.y, start.z] as const;
    const endPoint = [end.x, end.y, end.z] as const;

    if (currentColor !== segmentColor || currentPoints.length === 0) {
      currentPoints = [startPoint, endPoint];
      currentColor = segmentColor;
      segments.push({
        id: `${path.id}:${segments.length}`,
        name: pathName,
        color: segmentColor,
        kind: path.kind,
        points: currentPoints,
      });
      continue;
    }

    currentPoints.push(endPoint);
  }

  return segments;
}

type SweptSimulationFramesResponse = {
  startIndex: number;
  frames: SweptSimulationFrameResponse[];
};

type MeshCacheState = "idle" | "saving" | "ready" | "error";

type CachedMeshPayload = {
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
};

type SidebarSettingsPayload = {
  selectedOperationId: string | null;
  operations: Pocket2DOperationConfig[];
};

const CACHED_MESH_STORAGE_KEY = "opencam.cached-stl";
const SIDEBAR_SETTINGS_STORAGE_KEY = "opencam.sidebar-settings.v2";
const ORIGINAL_MESH_COLOR = 0x94a3b8;
const ORIGINAL_MESH_EDGE_COLOR = 0x334155;
const MILLED_STOCK_MESH_COLOR = 0xfb923c;
const ACTIVE_DEBUG_MESH_COLOR = 0xf97316;
const SIMULATION_PLAYBACK_INTERVAL_MS = 15;
const SIMULATION_FRAME_BATCH_SIZE = 10;
const SIMULATION_SAMPLE_SPACING = 2;
const CHUNK_PADDING_X = 5;
const CHUNK_PADDING_Y = 5;
const CHUNK_PADDING_Z = 1;
const SIMULATION_PREFETCH_TRIGGER_FRAME_COUNT = Math.max(
  1,
  Math.ceil(SIMULATION_FRAME_BATCH_SIZE / 2),
);

function isCachedMeshPayload(value: unknown): value is CachedMeshPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Record<string, unknown>;

  return (
    typeof payload.name === "string" &&
    typeof payload.type === "string" &&
    typeof payload.lastModified === "number" &&
    typeof payload.dataUrl === "string"
  );
}

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

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }

      reject(new Error("Failed to read STL file."));
    };

    reader.onerror = () => {
      reject(reader.error ?? new Error("Failed to read STL file."));
    };

    reader.readAsDataURL(file);
  });
}

function dataUrlToFile(
  dataUrl: string,
  name: string,
  type: string,
  lastModified: number,
) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    throw new Error("Invalid cached STL data.");
  }

  const header = dataUrl.slice(0, commaIndex);
  const encoded = dataUrl.slice(commaIndex + 1);
  const mimeMatch = header.match(/^data:(.*?);base64$/);
  const mimeType = type || mimeMatch?.[1] || "model/stl";
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new File([bytes], name, {
    type: mimeType,
    lastModified,
  });
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

async function prefetchMeshObjectUrl(url: string) {
  const response = await fetch(resolveBackendAssetUrl(url));

  if (!response.ok) {
    throw new Error(`Failed to load mesh (${response.status}).`);
  }

  const meshBlob = await response.blob();
  return URL.createObjectURL(meshBlob);
}

async function getMeshVertexMaxZ(file: File) {
  const loader = new STLLoader();
  const buffer = await file.arrayBuffer();
  const geometry = loader.parse(buffer);

  geometry.computeBoundingBox();

  const maxZ = geometry.boundingBox?.max.z ?? Number.NaN;
  geometry.dispose();

  if (!Number.isFinite(maxZ)) {
    throw new Error("Unable to determine the mesh Z maximum.");
  }

  return maxZ;
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

function parsePositiveNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return parsed;
}

function App() {
  const [meshFile, setMeshFile] = useState<File | null>(null);
  const [meshUrl, setMeshUrl] = useState<string | null>(null);
  const [meshCacheState, setMeshCacheState] = useState<MeshCacheState>("idle");
  const [meshCacheMessage, setMeshCacheMessage] = useState<string>("");
  const [hasInitializedMeshCache, setHasInitializedMeshCache] = useState(false);
  const skipNextMeshCacheWrite = useRef(false);
  const preserveMeshCacheMessageRef = useRef(false);
  const hasInitializedSidebarSettingsRef = useRef(false);
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);
  const [meshMaxZ, setMeshMaxZ] = useState<number | null>(null);
  const [operations, setOperations] = useState<Pocket2DOperationConfig[]>([]);
  const [selectedOperationId, setSelectedOperationId] = useState<string | null>(null);
  const [isOperationDialogOpen, setIsOperationDialogOpen] = useState(false);
  const [operationDialogMode, setOperationDialogMode] = useState<"create" | "edit">("create");
  const [resumeOperationDialogAfterSelection, setResumeOperationDialogAfterSelection] = useState(false);
  const [operationDraft, setOperationDraft] = useState<DraftObject | null>(null);
  const [generatedOperation, setGeneratedOperation] =
    useState<GeneratedOperationResponse | null>(null);
  const [simulationActiveMeshUrl, setSimulationActiveMeshUrl] = useState<string | null>(null);
  const [simulationCachedMeshUrl, setSimulationCachedMeshUrl] = useState<string | null>(null);
  const [simulationToolMeshUrl, setSimulationToolMeshUrl] = useState<string | null>(null);
  const [simulationToolPosition, setSimulationToolPosition] = useState<PolylinePoint | null>(null);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [simulationTaskId, setSimulationTaskId] = useState<string | null>(null);
  const [simulationProgressPercent, setSimulationProgressPercent] = useState(0);
  const [simulationFrameCount, setSimulationFrameCount] = useState(0);
  const [simulationChunkCount, setSimulationChunkCount] = useState(0);
  const [simulationFrameIndex, setSimulationFrameIndex] = useState(0);
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
  const simulationFrameCacheRef = useRef<Map<number, SweptSimulationFrameResponse>>(new Map());
  const simulationChunkMeshCacheRef = useRef<Map<number, string>>(new Map());
  const simulationChunkMeshRequestCacheRef = useRef<Map<number, Promise<string>>>(new Map());
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
  const [showOriginalMesh, setShowOriginalMesh] = useState(true);
  const maxSimDistance = "40";

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
  }, [operations, selectedOperationId]);

  useEffect(() => {
    if (typeof window === "undefined") {
      setHasInitializedMeshCache(true);
      return;
    }

    try {
      const cachedMesh = window.localStorage.getItem(CACHED_MESH_STORAGE_KEY);
      if (!cachedMesh) {
        return;
      }

      const parsed = JSON.parse(cachedMesh) as unknown;
      if (!isCachedMeshPayload(parsed)) {
        throw new Error("Invalid cached STL payload.");
      }

      skipNextMeshCacheWrite.current = true;
      setMeshFile(
        dataUrlToFile(parsed.dataUrl, parsed.name, parsed.type, parsed.lastModified),
      );
      setMeshCacheState("ready");
      setMeshCacheMessage("Restored from local storage.");
    } catch {
      preserveMeshCacheMessageRef.current = true;
      window.localStorage.removeItem(CACHED_MESH_STORAGE_KEY);
      setMeshCacheState("error");
      setMeshCacheMessage("Unable to restore the cached STL.");
    } finally {
      setHasInitializedMeshCache(true);
    }
  }, []);

  useEffect(() => {
    if (!meshFile) {
      setMeshUrl(null);
      return undefined;
    }

    const objectUrl = URL.createObjectURL(meshFile);
    setMeshUrl(objectUrl);

    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [meshFile]);

  useEffect(() => {
    if (!meshFile) {
      return undefined;
    }

    let cancelled = false;

    void getMeshVertexMaxZ(meshFile)
      .then((maxZ) => {
        if (cancelled) {
          return;
        }

        setMeshMaxZ(maxZ);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setMeshMaxZ(null);
          console.error("Failed to determine mesh Z max", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [meshFile]);

  useEffect(() => {
    if (!hasInitializedMeshCache || typeof window === "undefined") {
      return undefined;
    }

    if (skipNextMeshCacheWrite.current) {
      skipNextMeshCacheWrite.current = false;
      return undefined;
    }

    if (!meshFile) {
      window.localStorage.removeItem(CACHED_MESH_STORAGE_KEY);
      if (!preserveMeshCacheMessageRef.current) {
        setMeshCacheState("idle");
        setMeshCacheMessage("");
      }
      return undefined;
    }

    let cancelled = false;
    preserveMeshCacheMessageRef.current = false;
    window.localStorage.removeItem(CACHED_MESH_STORAGE_KEY);
    setMeshCacheState("saving");
    setMeshCacheMessage("");

    void fileToDataUrl(meshFile)
      .then((dataUrl) => {
        if (cancelled) {
          return;
        }

        const payload: CachedMeshPayload = {
          name: meshFile.name,
          type: meshFile.type || "model/stl",
          lastModified: meshFile.lastModified,
          dataUrl,
        };

        window.localStorage.setItem(
          CACHED_MESH_STORAGE_KEY,
          JSON.stringify(payload),
        );
        setMeshCacheState("ready");
        setMeshCacheMessage("Cached in local storage.");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        window.localStorage.removeItem(CACHED_MESH_STORAGE_KEY);
        setMeshCacheState("error");
        setMeshCacheMessage(
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "This STL is too large to cache in local storage."
            : "Unable to cache this STL in local storage.",
        );
      });

    return () => {
      cancelled = true;
    };
  }, [hasInitializedMeshCache, meshFile]);

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
    setSimulationId(null);
    setSimulationTaskId(null);
    setSimulationProgressPercent(0);
    setSimulationFrameCount(0);
    setSimulationChunkCount(0);
    setSimulationFrameIndex(0);
    setIsSimulationPlaying(false);
  }

  const generatedPaths = useMemo<GeneratedPathResponse[]>(
    () => generatedOperation?.paths ?? [],
    [generatedOperation],
  );
  const simulationSamples = useMemo(
    () => sampleToolpathLocations(generatedPaths, SIMULATION_SAMPLE_SPACING),
    [generatedPaths],
  );
  const simulationToolRotation = useMemo(() => {
    if (!simulationId || showOriginalMesh || simulationSamples.length === 0) {
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
  }, [showOriginalMesh, simulationFrameIndex, simulationId, simulationSamples]);
  const primaryMeshUrl = showOriginalMesh || !simulationCachedMeshUrl ? meshUrl : simulationCachedMeshUrl;
  const secondaryMeshUrl = showOriginalMesh ? null : simulationActiveMeshUrl;

  const operationPolylines = useMemo<PolylineDefinition[]>(() => {
    return generatedPaths.flatMap((path) => createDisplayPolylinesForPath(path));
  }, [generatedPaths]);

  const generatedPathLength = useMemo(() => {
    return operationPolylines.reduce(
      (total, polyline) => total + getPolylineLength(polyline.points),
      0,
    );
  }, [operationPolylines]);

  const generatedPathPointCount = useMemo(() => {
    return generatedPaths.reduce((total, path) => total + path.locations.length, 0);
  }, [generatedPaths]);

  const selectedOperation = useMemo(
    () => operations.find((operation) => operation.id === selectedOperationId) ?? null,
    [operations, selectedOperationId],
  );

  const operationLabel = selectedOperation?.displayName ?? "2D Pocket";
  const generateButtonLabel = requestState === "submitting" ? "Generating..." : "Generate pocket";

  const canGenerate = Boolean(meshUrl && meshFile && selectedOperation);

  const meshStatusLabel = meshFile ? meshFile.name : "No mesh loaded.";
  const meshCacheStatusLabel =
    meshCacheState === "saving" ? "Caching STL in local storage..." : meshCacheMessage;

  const fetchChunkMesh = useCallback(async (nextSimulationId: string, chunkIndex: number) => {
    const cachedMesh = simulationChunkMeshCacheRef.current.get(chunkIndex);
    if (cachedMesh) {
      return cachedMesh;
    }

    const inFlightRequest = simulationChunkMeshRequestCacheRef.current.get(chunkIndex);
    if (inFlightRequest) {
      return inFlightRequest;
    }

    const request = prefetchMeshObjectUrl(
      `/simulate/swept/${nextSimulationId}/chunks/${chunkIndex}/cached-mesh.glb`,
    )
      .then((objectUrl) => {
        simulationChunkMeshCacheRef.current.set(chunkIndex, objectUrl);
        return objectUrl;
      })
      .finally(() => {
        simulationChunkMeshRequestCacheRef.current.delete(chunkIndex);
      });

    simulationChunkMeshRequestCacheRef.current.set(chunkIndex, request);
    return request;
  }, []);

  const prefetchAdjacentChunkMeshes = useCallback(
    (nextSimulationId: string, chunkIndex: number, chunkCount: number) => {
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
    ) => {
      const cachedMeshUrl = await fetchChunkMesh(nextSimulationId, frame.chunkIndex);

      loadedSimulationFrameRef.current = {
        simulationId: nextSimulationId,
        frameIndex,
      };
      setSimulationActiveMeshUrl(frame.activeMeshUrl);
      setSimulationCachedMeshUrl(cachedMeshUrl);
      setSimulationToolPosition(toolPositionToPoint(frame.toolPosition));
      prefetchAdjacentChunkMeshes(nextSimulationId, frame.chunkIndex, chunkCount);
    },
    [fetchChunkMesh, prefetchAdjacentChunkMeshes],
  );

  const fetchSimulationFrameBatch = useCallback(
    async (
      nextSimulationId: string,
      startFrameIndex: number,
      count: number,
      totalFrameCount: number,
    ) => {
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
          `${getBackendUrl()}/simulate/swept/${nextSimulationId}/frames?start_index=${startFrameIndex}&count=${endFrameIndex - startFrameIndex + 1}`,
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
      if (frameIndex >= frameCount - 1) {
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

      await applySimulationFrame(nextSimulationId, frameIndex, frame, simulationChunkCount);
      prefetchSimulationFrames(nextSimulationId, frameIndex, frameCount);
    },
    [applySimulationFrame, fetchSimulationFrame, prefetchSimulationFrames, simulationChunkCount],
  );

  const applyCompletedSimulation = useCallback(
    async (simulation: SweptSimulationResponse) => {
      const finalFrameIndex = Math.max(simulation.frameCount - 1, 0);
      const finalFrame: SweptSimulationFrameResponse = {
        activeMeshUrl: await prefetchMeshObjectUrl(simulation.activeMeshUrl),
        cachedMeshUrl: simulation.cachedMeshUrl,
        chunkIndex: simulation.chunkIndex,
        toolPosition: simulation.toolPosition,
      };

      simulationFrameCacheRef.current.set(finalFrameIndex, finalFrame);
      simulationChunkMeshCacheRef.current.set(
        simulation.chunkIndex,
        await prefetchMeshObjectUrl(simulation.cachedMeshUrl),
      );
      loadedSimulationFrameRef.current = {
        simulationId: simulation.simulationId,
        frameIndex: finalFrameIndex,
      };
      setSimulationToolMeshUrl(resolveBackendAssetUrl(simulation.toolMeshUrl));
      setSimulationToolPosition(toolPositionToPoint(simulation.toolPosition));
      setSimulationId(simulation.simulationId);
      setSimulationFrameCount(simulation.frameCount);
      setSimulationChunkCount(simulation.chunkCount);
      setSimulationFrameIndex(finalFrameIndex);
      setIsSimulationPlaying(false);
      setSimulationActiveMeshUrl(finalFrame.activeMeshUrl);
      setSimulationCachedMeshUrl(
        simulationChunkMeshCacheRef.current.get(simulation.chunkIndex) ?? null,
      );
      if (simulation.frameCount > 0) {
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
      setShowOriginalMesh(false);
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
    if (!isSimulationPlaying || simulationFrameCount <= 1) {
      return undefined;
    }

    if (simulationFrameIndex >= simulationFrameCount - 1) {
      setIsSimulationPlaying(false);
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setSimulationFrameIndex((current) =>
        current >= simulationFrameCount - 1 ? current : current + 1,
      );
    }, SIMULATION_PLAYBACK_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isSimulationPlaying, simulationFrameCount, simulationFrameIndex]);

  function resetGeneratedPreview() {
    setGeneratedOperation(null);
    setSimulationActiveMeshUrl(null);
    setSimulationCachedMeshUrl(null);
    resetSimulationPlaybackState();
    setRequestState("idle");
    setRequestMessage("");
    setShowOriginalMesh(true);
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
    setRequestMessage("Select a flat XY-coplanar area in the viewport. Press Escape to cancel.");
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

  function handleAddPocketOperation() {
    if (!meshUrl) {
      setRequestState("error");
      setRequestMessage("Upload an STL before adding a pocket operation.");
      return;
    }

    setOperationDialogMode("create");
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(createPocketOperationDraft(operations.length + 1, null, meshMaxZ));
    setIsOperationDialogOpen(true);
  }

  function handleEditSelectedOperation() {
    if (!selectedOperation) {
      return;
    }

    setOperationDialogMode("edit");
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(
      createPocketOperationDraft(
        operations.findIndex((operation) => operation.id === selectedOperation.id) + 1,
        null,
        meshMaxZ,
        selectedOperation,
      ),
    );
    setIsOperationDialogOpen(true);
  }

  function handleOperationDialogSave() {
    if (!operationDraft) {
      return;
    }

    try {
      const parsedOperation = parsePocketOperationDraft(operationDraft);

      if (operationDialogMode === "create") {
        setOperations((current) => [...current, parsedOperation]);
        setSelectedOperationId(parsedOperation.id ?? null);
      } else {
        setOperations((current) =>
          current.map((operation) =>
            operation.id === parsedOperation.id ? parsedOperation : operation,
          ),
        );
        setSelectedOperationId(parsedOperation.id ?? null);
      }

      resetGeneratedPreview();
      setIsOperationDialogOpen(false);
      setResumeOperationDialogAfterSelection(false);
      setOperationDraft(null);
    } catch (error) {
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to save operation.",
      );
    }
  }

  function handleRemoveOperation(operationId: string) {
    setOperations((current) => current.filter((operation) => operation.id !== operationId));
    setSelectedOperationId((current) => (current === operationId ? null : current));
    resetGeneratedPreview();
  }

  function handleSelectOperation(operationId: string) {
    setSelectedOperationId(operationId);
    resetGeneratedPreview();
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
    setShowOriginalMesh(false);
    setSimulationFrameIndex(nextFrameIndex);
  }

  function handleSimulationPlay() {
    if (!simulationId || simulationFrameCount === 0) {
      return;
    }

    setShowOriginalMesh(false);
    setSimulationFrameIndex((current) =>
      current >= simulationFrameCount - 1 && simulationFrameCount > 1 ? 0 : current,
    );
    setIsSimulationPlaying(true);
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
      showOriginalMesh,
    });
  }, [generatedOperation, meshUrl, requestMessage, requestState, selectedMeshFace, selectedOperation, showOriginalMesh, simulationId, simulationTaskId]);

  useEffect(() => {
    if (!simulationTaskId || requestState !== "submitting") {
      return undefined;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    const pollStatus = async () => {
      try {
        const response = await fetch(`${getBackendUrl()}/simulate/swept/${simulationTaskId}/status`);
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
          setRequestState("success");
          setRequestMessage(`${operationLabel} toolpaths generated and chunked swept simulation completed.`);
          return;
        }

        if (status.status === "cancelled") {
          setSimulationTaskId(null);
          setSimulationProgressPercent(0);
          setSimulationActiveMeshUrl(null);
          setSimulationCachedMeshUrl(null);
          resetSimulationPlaybackState();
          setShowOriginalMesh(true);
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

        setSimulationTaskId(null);
        setSimulationProgressPercent(0);
        setSimulationActiveMeshUrl(null);
        setSimulationCachedMeshUrl(null);
        resetSimulationPlaybackState();
        setShowOriginalMesh(true);
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
  }, [applyCompletedSimulation, operationLabel, requestState, simulationTaskId]);

  async function handleGenerateOperation() {
    if (!selectedOperation) {
      setRequestState("error");
      setRequestMessage("Add and select a pocket operation before generating a toolpath.");
      return;
    }

    if (!meshFile) {
      setRequestState("error");
      setRequestMessage("Upload an STL before generating a toolpath.");
      return;
    }

    try {
      const requestBody = buildGenerateToolpathRequest(selectedOperation, meshMaxZ);
      const parsedMaxSimDistance = parsePositiveNumber(maxSimDistance, "Max sim distance");

      setGeneratedOperation(null);
      setSimulationActiveMeshUrl(null);
      setSimulationCachedMeshUrl(null);
      resetSimulationPlaybackState();
      setShowOriginalMesh(true);
      setRequestState("submitting");
      setRequestMessage(`Generating ${operationLabel.toLowerCase()} toolpath...`);

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
      simulationRequest.append("mesh", meshFile, meshFile.name);
      simulationRequest.append("operation", JSON.stringify(operation));
      simulationRequest.append("max_sim_distance", String(parsedMaxSimDistance));
      simulationRequest.append("chunk_padding_x", String(CHUNK_PADDING_X));
      simulationRequest.append("chunk_padding_y", String(CHUNK_PADDING_Y));
      simulationRequest.append("chunk_padding_z", String(CHUNK_PADDING_Z));

      setGeneratedOperation(operation);
      setRequestMessage("Starting chunked swept milling simulation...");

      const simulationResponse = await fetch(`${getBackendUrl()}/simulate/swept`, {
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
      setGeneratedOperation(null);
      setSimulationActiveMeshUrl(null);
      setSimulationCachedMeshUrl(null);
      resetSimulationPlaybackState();
      setShowOriginalMesh(true);
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
      await fetch(`${getBackendUrl()}/simulate/swept/${simulationTaskId}`, {
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

  function handleMeshUpload(file: File | null) {
    skipNextMeshCacheWrite.current = false;
    preserveMeshCacheMessageRef.current = false;
    setMeshCacheState(file ? "saving" : "idle");
    setMeshCacheMessage("");
    setMeshFile(file);
    setMeshMaxZ(null);
    setSelectedMeshFace(null);
    setOperations([]);
    setSelectedOperationId(null);
    setGeneratedOperation(null);
    setSimulationActiveMeshUrl(null);
    setSimulationCachedMeshUrl(null);
    resetSimulationPlaybackState();
    setRequestState("idle");
    setRequestMessage("");
    setShowOriginalMesh(true);
    setFaceSelectionMode(false);
    setIsOperationDialogOpen(false);
    setResumeOperationDialogAfterSelection(false);
    setOperationDraft(null);
  }

  return (
    <SidebarProvider defaultOpen>
      <div className="flex h-svh w-full flex-col overflow-hidden bg-background text-foreground">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b px-2 py-1.5 md:px-3">
          <div className="flex items-center gap-2">
            <SidebarTrigger />
            <h2 className="text-sm font-semibold md:text-base">OpenCAM Viewer</h2>
          </div>

          <ModeToggle />
        </header>

        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <AppSidebar
            meshLoaded={Boolean(meshUrl)}
            meshStatusLabel={meshStatusLabel}
            meshCacheStatusLabel={meshCacheStatusLabel}
            operations={operations}
            selectedOperationId={selectedOperationId}
            canGenerate={canGenerate}
            requestState={requestState}
            requestMessage={requestMessage}
            generateButtonLabel={generateButtonLabel}
            generatedPathCount={generatedPaths.length}
            generatedPathPointCount={generatedPathPointCount}
            generatedPathLength={generatedPathLength}
            onMeshUpload={handleMeshUpload}
            onAddPocketOperation={handleAddPocketOperation}
            onEditSelectedOperation={handleEditSelectedOperation}
            onSelectOperation={handleSelectOperation}
            onRemoveOperation={handleRemoveOperation}
            onGenerateOperation={handleGenerateOperation}
            canCancelGeneration={requestState === "submitting" && simulationTaskId !== null}
            onCancelGeneration={handleCancelGeneration}
          />

          <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PolylineViewer
              meshUrl={primaryMeshUrl}
              secondaryMeshUrl={secondaryMeshUrl}
              meshColor={showOriginalMesh || !simulationCachedMeshUrl ? ORIGINAL_MESH_COLOR : MILLED_STOCK_MESH_COLOR}
              meshEdgeColor={showOriginalMesh || !simulationCachedMeshUrl ? ORIGINAL_MESH_EDGE_COLOR : null}
              secondaryMeshColor={ACTIVE_DEBUG_MESH_COLOR}
              secondaryMeshEdgeColor={null}
              polylines={operationPolylines}
              faceSelectionMode={faceSelectionMode}
              selectedMeshFace={selectedMeshFace}
              simulationToolMeshUrl={simulationToolMeshUrl}
              simulationToolPosition={simulationToolPosition}
              simulationToolRotation={simulationToolRotation}
              showOriginalMesh={showOriginalMesh}
              onMeshFaceSelect={handleMeshFaceSelect}
              className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none"
            />

            {simulationId && simulationFrameCount > 0 ? (
              <div className="pointer-events-none absolute inset-x-4 bottom-4 z-20">
                <div className="pointer-events-auto mx-auto flex max-w-3xl items-center gap-3 rounded-md border bg-background/95 px-3 py-2 shadow">
                  <Button
                    type="button"
                    variant="outline"
                    disabled={simulationFrameCount <= 1}
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
                    className="flex-1"
                  />

                  <div className="w-24 text-right text-xs text-muted-foreground">
                    Frame {simulationFrameIndex + 1} / {simulationFrameCount}
                  </div>
                </div>
              </div>
            ) : null}

            {simulationCachedMeshUrl ? (
              <div className="pointer-events-none absolute bottom-20 right-4 z-20">
                <Button
                  type="button"
                  variant="outline"
                  className="pointer-events-auto"
                  onClick={() => setShowOriginalMesh((current) => !current)}
                >
                  {showOriginalMesh ? "Show milled stock" : "Show uploaded mesh"}
                </Button>
              </div>
            ) : null}
          </main>
        </div>

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
