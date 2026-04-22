import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

import {
  AppSidebar,
  type FormValues,
  type NumericField,
  type NumericSanitizerOptions,
  type OperationType,
  type RequestState,
} from "@/components/app-sidebar";
import { ModeToggle } from "@/components/mode-toggle";
import {
  PolylineViewer,
  type MeshFaceSelection,
  type PolylineDefinition,
  type PolylinePoint,
} from "@/components/polyline-viewer";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { getBackendUrl } from "@/hooks/useBackendConnection";

type GeneratedPathResponse = {
  id: string;
  name: string | null;
  kind: "cut" | "clearance";
  locations: Array<{
    x: number;
    y: number;
    z: number;
    comment?: string | null;
  }>;
};

type MeshCacheState = "idle" | "saving" | "ready" | "error";

type CachedMeshPayload = {
  name: string;
  type: string;
  lastModified: number;
  dataUrl: string;
};

const CACHED_MESH_STORAGE_KEY = "opencam.cached-stl";

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

function sanitizeNumericInput(
  value: string,
  {
    allowNegative = false,
    allowDecimal = true,
    maxDecimalPlaces = 3,
  }: NumericSanitizerOptions = {},
) {
  let sanitized = "";
  let hasDecimalPoint = false;

  for (const character of value) {
    if (character >= "0" && character <= "9") {
      sanitized += character;
      continue;
    }

    if (character === "-" && allowNegative && sanitized.length === 0) {
      sanitized += character;
      continue;
    }

    if (character === "." && allowDecimal && !hasDecimalPoint) {
      sanitized += character;
      hasDecimalPoint = true;
    }
  }

  if (!allowDecimal) {
    return sanitized;
  }

  const [integerPart, decimalPart] = sanitized.split(".");

  if (decimalPart === undefined) {
    return sanitized;
  }

  return `${integerPart}.${decimalPart.slice(0, maxDecimalPlaces)}`;
}

function formatNumericValue(
  value: number,
  options?: NumericSanitizerOptions,
) {
  if (!Number.isFinite(value)) {
    return "";
  }

  const formatted = sanitizeNumericInput(
    value.toFixed(options?.maxDecimalPlaces ?? 3),
    options,
  );

  return Number(formatted) === 0 ? "0" : formatted;
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

function parsePositiveNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }

  return parsed;
}

function parseNonNegativeNumber(value: string, label: string) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`${label} must be 0 or greater.`);
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
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedOperation, setSelectedOperation] = useState<OperationType>("profile");
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);
  const [generatedPaths, setGeneratedPaths] = useState<GeneratedPathResponse[]>([]);
  const [requestState, setRequestState] = useState<RequestState>("idle");
  const [requestMessage, setRequestMessage] = useState<string>("");
  const [formValues, setFormValues] = useState<FormValues>({
    toolDiameter: "6.35",
    cuttingHeight: "12",
    maxDepthOfCut: "1.5",
    zStepHeight: "1.5",
    feedrate: "500",
    rpm: "12000",
    zMin: "",
    zMax: "",
    clearancePlaneHeight: "25.4",
    stepover: "25",
    stockToLeave: "0",
    side: "outside",
  });

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

        setFormValues((current) => ({
          ...current,
          zMax: formatNumericValue(maxZ, { allowNegative: true }),
        }));
      })
      .catch((error: unknown) => {
        if (!cancelled) {
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

  const operationPolylines = useMemo<PolylineDefinition[]>(() => {
    return generatedPaths.map((path) => ({
      id: path.id,
      name: path.name ?? (path.kind === "clearance" ? "Clearance move" : "Generated profile"),
      color: path.kind === "clearance" ? "#dc2626" : "#1d4ed8",
      points: path.locations.map(({ x, y, z }) => [x, y, z] as const),
    }));
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

  const operationLabel = selectedOperation === "profile" ? "Closed profile" : "2.5D pocket";
  const generateButtonLabel =
    requestState === "submitting"
      ? "Generating..."
      : selectedOperation === "profile"
        ? "Generate profile"
        : "Generate pocket";

  const canGenerate = Boolean(
    meshUrl &&
      selectedMeshFace &&
      selectedMeshFace.isParallelToXY &&
      selectedMeshFace.boundaryLoop &&
      !selectedMeshFace.validationError &&
      formValues.zMin.trim() !== "" &&
      formValues.zMax.trim() !== "",
  );

  const meshStatusLabel = meshFile ? meshFile.name : "No mesh loaded.";
  const meshCacheStatusLabel =
    meshCacheState === "saving" ? "Caching STL in local storage..." : meshCacheMessage;

  function updateNumericField(
    field: NumericField,
    value: string,
    options?: NumericSanitizerOptions,
  ) {
    setFormValues((current) => ({
      ...current,
      [field]: sanitizeNumericInput(value, options),
    }));
  }

  const handleMeshFaceSelect = useCallback((selection: MeshFaceSelection) => {
    setSelectedMeshFace(selection);
    setGeneratedPaths([]);
    setRequestState("idle");
    setRequestMessage("");
    setFaceSelectionMode(false);
    setFormValues((current) => ({
      ...current,
      zMin:
        selection.planeZ != null
          ? formatNumericValue(selection.planeZ, { allowNegative: true })
          : "",
    }));
  }, []);

  async function handleGenerateOperation() {
    if (!selectedMeshFace) {
      setRequestState("error");
      setRequestMessage("Select a face before generating a toolpath.");
      return;
    }

    if (!selectedMeshFace.isParallelToXY || !selectedMeshFace.boundaryLoop || selectedMeshFace.validationError) {
      setRequestState("error");
      setRequestMessage(selectedMeshFace.validationError ?? "Selected face cannot be machined.");
      return;
    }

    if (selectedMeshFace.planeZ == null) {
      setRequestState("error");
      setRequestMessage("Selected face is missing a valid Z plane.");
      return;
    }

    try {
      const toolDiameter = parsePositiveNumber(formValues.toolDiameter, "Tool diameter");
      const cuttingHeight = parsePositiveNumber(formValues.cuttingHeight, "Cutting height");
      const maxDepthOfCut = parsePositiveNumber(formValues.maxDepthOfCut, "Max depth of cut");
      const zStepHeight = parsePositiveNumber(formValues.zStepHeight, "Z step height");
      const feedrate = parsePositiveNumber(formValues.feedrate, "Feedrate");
      const rpm = parsePositiveNumber(formValues.rpm, "RPM");
      const zMin = Number(formValues.zMin);
      const zMax = Number(formValues.zMax);
      const clearancePlaneHeight = Number(formValues.clearancePlaneHeight);
      const stockToLeave = parseNonNegativeNumber(formValues.stockToLeave, "Stock to leave");

      if (!Number.isFinite(zMin)) {
        throw new Error("Z min is required.");
      }

      if (!Number.isFinite(zMax)) {
        throw new Error("Z max is required.");
      }

      if (!Number.isFinite(clearancePlaneHeight)) {
        throw new Error("Clearance plane height is required.");
      }

      if (clearancePlaneHeight <= Math.max(zMin, zMax)) {
        throw new Error("Clearance plane height must be above the operation Z range.");
      }

      const requestBody: Record<string, unknown> = {
        ring: {
          vertices: selectedMeshFace.boundaryLoop.map(([x, y]) => ({ x, y })),
        },
        tool: {
          diameter: toolDiameter,
          cuttingHeight,
          maxDepthOfCut,
        },
        feedrate,
        rpm: Math.round(rpm),
        zBounds: [zMin, zMax],
        zStepHeight,
        clearancePlaneHeight,
        stockToLeave,
      };

      const endpoint =
        selectedOperation === "profile" ? "/profile/closed" : "/pocket/closed";

      if (selectedOperation === "profile") {
        requestBody.side = formValues.side;
      } else {
        const stepover = parsePositiveNumber(formValues.stepover, "Stepover");
        if (stepover > 100) {
          throw new Error("Stepover must be 100 or less.");
        }
        requestBody.stepover = stepover;
      }

      setRequestState("submitting");
      setRequestMessage(`Generating ${operationLabel.toLowerCase()} toolpath...`);

      const response = await fetch(`${getBackendUrl()}${endpoint}`, {
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

      const paths = (await response.json()) as GeneratedPathResponse[];
      setGeneratedPaths(paths);
      setRequestState("success");
      setRequestMessage(`${operationLabel} toolpaths generated.`);
    } catch (error) {
      setGeneratedPaths([]);
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to generate toolpath.",
      );
    }
  }

  function handleMeshUpload(file: File | null) {
    skipNextMeshCacheWrite.current = false;
    preserveMeshCacheMessageRef.current = false;
    setMeshCacheState(file ? "saving" : "idle");
    setMeshCacheMessage("");
    setMeshFile(file);
    setSelectedMeshFace(null);
    setGeneratedPaths([]);
    setRequestState("idle");
    setRequestMessage("");
    setFaceSelectionMode(false);
    setFormValues((current) => ({
      ...current,
      zMin: "",
      zMax: "",
    }));
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
            faceSelectionMode={faceSelectionMode}
            selectedOperation={selectedOperation}
            selectedMeshFace={selectedMeshFace}
            formValues={formValues}
            canGenerate={canGenerate}
            requestState={requestState}
            requestMessage={requestMessage}
            generateButtonLabel={generateButtonLabel}
            generatedPathCount={generatedPaths.length}
            generatedPathPointCount={generatedPathPointCount}
            generatedPathLength={generatedPathLength}
            onMeshUpload={handleMeshUpload}
            onToggleFaceSelection={() => setFaceSelectionMode((current) => !current)}
            onOperationChange={(operation) => {
              setSelectedOperation(operation);
              setGeneratedPaths([]);
              setRequestState("idle");
              setRequestMessage("");
            }}
            onUpdateNumericField={updateNumericField}
            onSideChange={(side) =>
              setFormValues((current) => ({
                ...current,
                side,
              }))
            }
            onGenerateOperation={handleGenerateOperation}
          />

          <main className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <PolylineViewer
              meshUrl={meshUrl}
              polylines={operationPolylines}
              faceSelectionMode={faceSelectionMode}
              selectedMeshFace={selectedMeshFace}
              onMeshFaceSelect={handleMeshFaceSelect}
              className="h-full min-h-0 flex-1 rounded-none border-0 shadow-none"
            />
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}

export default App;
