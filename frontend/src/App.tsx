import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PolylineViewer,
  type MeshFaceSelection,
  type PolylineDefinition,
  type PolylinePoint,
} from "@/components/polyline-viewer";
import { ModeToggle } from "@/components/mode-toggle";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { getBackendUrl } from "@/hooks/useBackendConnection";

type GeneratedPathResponse = {
  id: string;
  name: string | null;
  locations: Array<{
    x: number;
    y: number;
    z: number;
    comment?: string | null;
  }>;
};

type RequestState = "idle" | "submitting" | "success" | "error";
type ProfilingSide = "outside" | "inside";

type FormValues = {
  toolDiameter: string;
  cuttingHeight: string;
  maxDepthOfCut: string;
  zStepHeight: string;
  feedrate: string;
  rpm: string;
  zMin: string;
  zMax: string;
  stockToLeave: string;
  side: ProfilingSide;
};

type NumericField = Exclude<keyof FormValues, "side">;

type NumericSanitizerOptions = {
  allowNegative?: boolean;
  allowDecimal?: boolean;
  maxDecimalPlaces?: number;
};

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
  const [faceSelectionMode, setFaceSelectionMode] = useState(false);
  const [selectedMeshFace, setSelectedMeshFace] = useState<MeshFaceSelection | null>(null);
  const [generatedPath, setGeneratedPath] = useState<GeneratedPathResponse | null>(null);
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
    stockToLeave: "0",
    side: "outside",
  });

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

  const operationPolylines = useMemo<PolylineDefinition[]>(() => {
    if (!generatedPath) {
      return [];
    }

    return [
      {
        id: generatedPath.id,
        name: generatedPath.name ?? "Generated profile",
        color: "#1d4ed8",
        points: generatedPath.locations.map(({ x, y, z }) => [x, y, z] as const),
      },
    ];
  }, [generatedPath]);

  const generatedPathLength = useMemo(() => {
    if (operationPolylines.length === 0) {
      return 0;
    }

    return getPolylineLength(operationPolylines[0].points);
  }, [operationPolylines]);

  const canGenerate = Boolean(
    meshUrl &&
      selectedMeshFace &&
      selectedMeshFace.isParallelToXY &&
      selectedMeshFace.boundaryLoop &&
      !selectedMeshFace.validationError &&
      formValues.zMin.trim() !== "" &&
      formValues.zMax.trim() !== "",
  );

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
    setGeneratedPath(null);
    setRequestState("idle");
    setRequestMessage("");
    setFaceSelectionMode(false);
    setFormValues((current) => ({
      ...current,
      zMin:
        selection.planeZ != null
          ? formatNumericValue(selection.planeZ, { allowNegative: true })
          : "",
      zMax: "",
    }));
  }, []);

  async function handleGenerateProfile() {
    if (!selectedMeshFace) {
      setRequestState("error");
      setRequestMessage("Select a face before generating a profile.");
      return;
    }

    if (!selectedMeshFace.isParallelToXY || !selectedMeshFace.boundaryLoop || selectedMeshFace.validationError) {
      setRequestState("error");
      setRequestMessage(selectedMeshFace.validationError ?? "Selected face cannot be profiled.");
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
      const stockToLeave = parseNonNegativeNumber(formValues.stockToLeave, "Stock to leave");

      if (!Number.isFinite(zMin)) {
        throw new Error("Z min is required.");
      }

      if (!Number.isFinite(zMax)) {
        throw new Error("Z max is required.");
      }

      setRequestState("submitting");
      setRequestMessage("Generating toolpath...");

      const response = await fetch(`${getBackendUrl()}/profile/closed`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ring: {
            vertices: selectedMeshFace.boundaryLoop.map(([x, y]) => ({ x, y })),
          },
          side: formValues.side,
          tool: {
            diameter: toolDiameter,
            cuttingHeight,
            maxDepthOfCut,
          },
          feedrate,
          rpm: Math.round(rpm),
          zBounds: [zMin, zMax],
          zStepHeight,
          stockToLeave,
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        throw new Error(detail || "Backend request failed.");
      }

      const path = (await response.json()) as GeneratedPathResponse;
      setGeneratedPath(path);
      setRequestState("success");
      setRequestMessage("Toolpath generated.");
    } catch (error) {
      setGeneratedPath(null);
      setRequestState("error");
      setRequestMessage(
        error instanceof Error ? error.message : "Failed to generate toolpath.",
      );
    }
  }

  function handleMeshUpload(file: File | null) {
    setMeshFile(file);
    setSelectedMeshFace(null);
    setGeneratedPath(null);
    setRequestState("idle");
    setRequestMessage("");
    setFaceSelectionMode(false);
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
          <Sidebar>
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>Mesh</SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="space-y-2 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3">
                    <div className="space-y-1">
                      <Label htmlFor="mesh-upload">Upload STL</Label>
                      <Input
                        id="mesh-upload"
                        type="file"
                        accept=".stl,model/stl"
                        onChange={(event) => handleMeshUpload(event.target.files?.[0] ?? null)}
                      />
                    </div>

                    <p className="text-xs leading-5 text-sidebar-foreground/65">
                      {meshFile ? meshFile.name : "No mesh loaded."}
                    </p>
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup>
                <SidebarGroupLabel>Face selection</SidebarGroupLabel>
                <SidebarGroupContent>
                  <Button
                    type="button"
                    variant={faceSelectionMode ? "default" : "outline"}
                    className="w-full justify-start"
                    onClick={() => setFaceSelectionMode((current) => !current)}
                    disabled={!meshUrl}
                  >
                    {faceSelectionMode ? "Click a mesh face in the viewport" : "Select XY-coplanar face"}
                  </Button>

                  <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3 text-sm">
                    {selectedMeshFace ? (
                      <div className="space-y-2">
                        <div>
                          <div className="font-medium">{selectedMeshFace.label}</div>
                          <div className="mt-1 text-xs leading-5 text-sidebar-foreground/65">
                            {selectedMeshFace.area.toFixed(0)} mm² · {selectedMeshFace.triangleCount} triangles
                          </div>
                        </div>

                        {selectedMeshFace.planeZ != null ? (
                          <div className="text-xs leading-5 text-sidebar-foreground/65">
                            Plane Z: {selectedMeshFace.planeZ.toFixed(3)} mm
                          </div>
                        ) : null}

                        {selectedMeshFace.boundaryLoop ? (
                          <div className="text-xs leading-5 text-sidebar-foreground/65">
                            Boundary loop: {selectedMeshFace.boundaryLoop.length - 1} edges
                          </div>
                        ) : null}

                        <p className="text-xs leading-5 text-sidebar-foreground/65">
                          {selectedMeshFace.validationError ?? "Ready to profile this face."}
                        </p>
                      </div>
                    ) : (
                      <p className="text-xs leading-5 text-sidebar-foreground/65">
                        {meshUrl
                          ? "No face selected. Pick a face that is coplanar to XY."
                          : "Upload an STL to enable face selection."}
                      </p>
                    )}
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>

              <SidebarGroup>
                <SidebarGroupLabel>Profiling</SidebarGroupLabel>
                <SidebarGroupContent>
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3">
                    <div className="space-y-1">
                      <Label htmlFor="tool-diameter">Tool diameter</Label>
                      <Input
                        id="tool-diameter"
                        type="text"
                        inputMode="decimal"
                        value={formValues.toolDiameter}
                        onChange={(event) => updateNumericField("toolDiameter", event.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="cutting-height">Cutting height</Label>
                      <Input
                        id="cutting-height"
                        type="text"
                        inputMode="decimal"
                        value={formValues.cuttingHeight}
                        onChange={(event) => updateNumericField("cuttingHeight", event.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="max-depth">Max depth of cut</Label>
                      <Input
                        id="max-depth"
                        type="text"
                        inputMode="decimal"
                        value={formValues.maxDepthOfCut}
                        onChange={(event) => updateNumericField("maxDepthOfCut", event.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="z-step-height">Z step height</Label>
                      <Input
                        id="z-step-height"
                        type="text"
                        inputMode="decimal"
                        value={formValues.zStepHeight}
                        onChange={(event) => updateNumericField("zStepHeight", event.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="z-min">Z min</Label>
                      <Input
                        id="z-min"
                        type="text"
                        inputMode="decimal"
                        value={formValues.zMin}
                        onChange={(event) =>
                          updateNumericField("zMin", event.target.value, { allowNegative: true })
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="z-max">Z max</Label>
                      <Input
                        id="z-max"
                        type="text"
                        inputMode="decimal"
                        value={formValues.zMax}
                        onChange={(event) =>
                          updateNumericField("zMax", event.target.value, { allowNegative: true })
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="feedrate">Feedrate</Label>
                      <Input
                        id="feedrate"
                        type="text"
                        inputMode="numeric"
                        value={formValues.feedrate}
                        onChange={(event) =>
                          updateNumericField("feedrate", event.target.value, { allowDecimal: false })
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="rpm">RPM</Label>
                      <Input
                        id="rpm"
                        type="text"
                        inputMode="numeric"
                        value={formValues.rpm}
                        onChange={(event) =>
                          updateNumericField("rpm", event.target.value, { allowDecimal: false })
                        }
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="stock-to-leave">Stock to leave</Label>
                      <Input
                        id="stock-to-leave"
                        type="text"
                        inputMode="decimal"
                        value={formValues.stockToLeave}
                        onChange={(event) => updateNumericField("stockToLeave", event.target.value)}
                      />
                    </div>

                    <div className="space-y-1">
                      <Label htmlFor="profile-side">Profile side</Label>
                      <select
                        id="profile-side"
                        value={formValues.side}
                        onChange={(event) =>
                          setFormValues((current) => ({
                            ...current,
                            side: event.target.value as ProfilingSide,
                          }))
                        }
                        className="border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
                      >
                        <option value="outside">Outside</option>
                        <option value="inside">Inside</option>
                      </select>
                    </div>
                  </div>
                </SidebarGroupContent>
              </SidebarGroup>
            </SidebarContent>

            <SidebarFooter>
              <div className="space-y-3 rounded-xl border border-sidebar-border bg-sidebar-accent/45 p-3">
                <Button
                  type="button"
                  className="w-full"
                  disabled={!canGenerate || requestState === "submitting"}
                  onClick={handleGenerateProfile}
                >
                  {requestState === "submitting" ? "Generating..." : "Generate profile"}
                </Button>

                {requestMessage ? (
                  <p className="text-xs leading-5 text-sidebar-foreground/65">{requestMessage}</p>
                ) : (
                  <p className="text-xs leading-5 text-sidebar-foreground/65">
                    Upload an STL, select one XY-coplanar face, then generate a single profiling path.
                  </p>
                )}

                {generatedPath ? (
                  <div className="rounded-lg border border-sidebar-border bg-background/60 p-3 text-sm">
                    <div className="font-medium">Generated operation</div>
                    <div className="mt-1 text-xs leading-5 text-sidebar-foreground/65">
                      {generatedPath.locations.length} points · {generatedPathLength.toFixed(1)} mm
                    </div>
                  </div>
                ) : null}
              </div>
            </SidebarFooter>
          </Sidebar>

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
