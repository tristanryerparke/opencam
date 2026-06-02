import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type MeshFaceSelection } from "@/components/polyline-viewer";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";

export type RequestState = "idle" | "submitting" | "success" | "error";
export type OperationType = "profile" | "pocket";
export type ProfilingSide = "outside" | "inside";

export type FormValues = {
  toolDiameter: string;
  cuttingHeight: string;
  maxDepthOfCut: string;
  zStepHeight: string;
  feedrate: string;
  rpm: string;
  zMin: string;
  zMax: string;
  clearancePlaneHeight: string;
  stepover: string;
  stockToLeave: string;
  maxSimDistance: string;
  chunkPaddingX: string;
  chunkPaddingY: string;
  chunkPaddingZ: string;
  side: ProfilingSide;
};

export type NumericField = Exclude<keyof FormValues, "side">;

export type NumericSanitizerOptions = {
  allowNegative?: boolean;
  allowDecimal?: boolean;
  maxDecimalPlaces?: number;
};

type AppSidebarProps = {
  meshLoaded: boolean;
  meshStatusLabel: string;
  meshCacheStatusLabel: string;
  faceSelectionMode: boolean;
  selectedOperation: OperationType;
  selectedMeshFace: MeshFaceSelection | null;
  formValues: FormValues;
  canGenerate: boolean;
  requestState: RequestState;
  requestMessage: string;
  generateButtonLabel: string;
  generatedPathCount: number;
  generatedPathPointCount: number;
  generatedPathLength: number;
  onMeshUpload: (file: File | null) => void;
  onToggleFaceSelection: () => void;
  onOperationChange: (operation: OperationType) => void;
  onUpdateNumericField: (
    field: NumericField,
    value: string,
    options?: NumericSanitizerOptions,
  ) => void;
  onSideChange: (side: ProfilingSide) => void;
  onGenerateOperation: () => void;
};

const SELECT_CLASSNAME =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

export function AppSidebar({
  meshLoaded,
  meshStatusLabel,
  meshCacheStatusLabel,
  faceSelectionMode,
  selectedOperation,
  selectedMeshFace,
  formValues,
  canGenerate,
  requestState,
  requestMessage,
  generateButtonLabel,
  generatedPathCount,
  generatedPathPointCount,
  generatedPathLength,
  onMeshUpload,
  onToggleFaceSelection,
  onOperationChange,
  onUpdateNumericField,
  onSideChange,
  onGenerateOperation,
}: AppSidebarProps) {
  return (
    <Sidebar>
      <SidebarContent className="gap-3 p-3">
        <div className="space-y-1">
          <Label htmlFor="mesh-upload">Upload STL</Label>
          <Input
            id="mesh-upload"
            type="file"
            accept=".stl,model/stl"
            onChange={(event) => onMeshUpload(event.target.files?.[0] ?? null)}
          />
        </div>

        <p className="text-xs leading-5 text-sidebar-foreground/65">{meshStatusLabel}</p>

        {meshCacheStatusLabel ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">{meshCacheStatusLabel}</p>
        ) : null}

        <Button
          type="button"
          variant={faceSelectionMode ? "default" : "outline"}
          className="w-full justify-start"
          onClick={onToggleFaceSelection}
          disabled={!meshLoaded}
        >
          {faceSelectionMode ? "Click a mesh face in the viewport" : "Select XY-coplanar face"}
        </Button>

        {selectedMeshFace ? (
          <div className="space-y-1 text-sm">
            <div className="font-medium">{selectedMeshFace.label}</div>
            <p className="text-xs leading-5 text-sidebar-foreground/65">
              {selectedMeshFace.area.toFixed(0)} mm² · {selectedMeshFace.triangleCount} triangles
            </p>

            {selectedMeshFace.planeZ != null ? (
              <p className="text-xs leading-5 text-sidebar-foreground/65">
                Plane Z: {selectedMeshFace.planeZ.toFixed(3)} mm
              </p>
            ) : null}

            {selectedMeshFace.boundaryLoop ? (
              <p className="text-xs leading-5 text-sidebar-foreground/65">
                Boundary loop: {selectedMeshFace.boundaryLoop.length - 1} edges
              </p>
            ) : null}

            <p className="text-xs leading-5 text-sidebar-foreground/65">
              {selectedMeshFace.validationError ?? "Ready to machine this face."}
            </p>
          </div>
        ) : meshLoaded ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            No face selected. Pick a face that is coplanar to XY.
          </p>
        ) : null}

        <div className="space-y-1">
          <Label htmlFor="operation-selector">Operation</Label>
          <select
            id="operation-selector"
            value={selectedOperation}
            onChange={(event) => onOperationChange(event.target.value as OperationType)}
            className={SELECT_CLASSNAME}
          >
            <option value="profile">Closed profile</option>
            <option value="pocket">2.5D pocket</option>
          </select>
        </div>

        <p className="text-xs leading-5 text-sidebar-foreground/65">
          {selectedOperation === "profile"
            ? "Offset the selected closed loop inward or outward."
            : "Clear the selected closed region using concentric pocketing rings."}
        </p>

        <div className="space-y-1">
          <Label htmlFor="tool-diameter">Tool diameter</Label>
          <Input
            id="tool-diameter"
            type="text"
            inputMode="decimal"
            value={formValues.toolDiameter}
            onChange={(event) => onUpdateNumericField("toolDiameter", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="cutting-height">Cutting height</Label>
          <Input
            id="cutting-height"
            type="text"
            inputMode="decimal"
            value={formValues.cuttingHeight}
            onChange={(event) => onUpdateNumericField("cuttingHeight", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="max-depth">Max depth of cut</Label>
          <Input
            id="max-depth"
            type="text"
            inputMode="decimal"
            value={formValues.maxDepthOfCut}
            onChange={(event) => onUpdateNumericField("maxDepthOfCut", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="z-step-height">Z step height</Label>
          <Input
            id="z-step-height"
            type="text"
            inputMode="decimal"
            value={formValues.zStepHeight}
            onChange={(event) => onUpdateNumericField("zStepHeight", event.target.value)}
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
              onUpdateNumericField("zMin", event.target.value, { allowNegative: true })
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
              onUpdateNumericField("zMax", event.target.value, { allowNegative: true })
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="clearance-plane-height">Clearance plane height</Label>
          <Input
            id="clearance-plane-height"
            type="text"
            inputMode="decimal"
            value={formValues.clearancePlaneHeight}
            onChange={(event) =>
              onUpdateNumericField("clearancePlaneHeight", event.target.value, {
                allowNegative: true,
              })
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
              onUpdateNumericField("feedrate", event.target.value, { allowDecimal: false })
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
              onUpdateNumericField("rpm", event.target.value, { allowDecimal: false })
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
            onChange={(event) => onUpdateNumericField("stockToLeave", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="max-sim-distance">Max sim distance</Label>
          <Input
            id="max-sim-distance"
            type="text"
            inputMode="decimal"
            value={formValues.maxSimDistance}
            onChange={(event) => onUpdateNumericField("maxSimDistance", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="chunk-padding-x">Chunk padding X</Label>
          <Input
            id="chunk-padding-x"
            type="text"
            inputMode="decimal"
            value={formValues.chunkPaddingX}
            onChange={(event) => onUpdateNumericField("chunkPaddingX", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="chunk-padding-y">Chunk padding Y</Label>
          <Input
            id="chunk-padding-y"
            type="text"
            inputMode="decimal"
            value={formValues.chunkPaddingY}
            onChange={(event) => onUpdateNumericField("chunkPaddingY", event.target.value)}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="chunk-padding-z">Chunk padding Z</Label>
          <Input
            id="chunk-padding-z"
            type="text"
            inputMode="decimal"
            value={formValues.chunkPaddingZ}
            onChange={(event) => onUpdateNumericField("chunkPaddingZ", event.target.value)}
          />
        </div>

        {selectedOperation === "pocket" ? (
          <div className="space-y-1">
            <Label htmlFor="stepover">Stepover (%)</Label>
            <Input
              id="stepover"
              type="text"
              inputMode="decimal"
              value={formValues.stepover}
              onChange={(event) => onUpdateNumericField("stepover", event.target.value)}
            />
          </div>
        ) : null}

        {selectedOperation === "profile" ? (
          <div className="space-y-1">
            <Label htmlFor="profile-side">Profile side</Label>
            <select
              id="profile-side"
              value={formValues.side}
              onChange={(event) => onSideChange(event.target.value as ProfilingSide)}
              className={SELECT_CLASSNAME}
            >
              <option value="outside">Outside</option>
              <option value="inside">Inside</option>
            </select>
          </div>
        ) : null}

        <Button
          type="button"
          className="w-full"
          disabled={!canGenerate || requestState === "submitting"}
          onClick={onGenerateOperation}
        >
          {generateButtonLabel}
        </Button>

        {requestMessage ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">{requestMessage}</p>
        ) : (
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            Upload an STL, select one XY-coplanar face, choose an operation, then generate the toolpath and swept stock simulation.
          </p>
        )}

        {generatedPathCount > 0 ? (
          <div className="space-y-1 text-sm">
            <div className="font-medium">Generated operation</div>
            <p className="text-xs leading-5 text-sidebar-foreground/65">
              {generatedPathCount} paths · {generatedPathPointCount} points · {generatedPathLength.toFixed(1)} mm
            </p>
          </div>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
