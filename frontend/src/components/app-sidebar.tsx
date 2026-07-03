import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sidebar, SidebarContent } from "@/components/ui/sidebar";
import { type MeshFaceSelection } from "@/components/polyline-viewer";
import { type Pocket2DOperationConfig } from "@/generated/cam-types";

export type RequestState = "idle" | "submitting" | "success" | "error";

type AppSidebarProps = {
  meshLoaded: boolean;
  meshStatusLabel: string;
  meshCacheStatusLabel: string;
  faceSelectionMode: boolean;
  selectedMeshFace: MeshFaceSelection | null;
  operations: Pocket2DOperationConfig[];
  selectedOperationId: string | null;
  canGenerate: boolean;
  requestState: RequestState;
  requestMessage: string;
  generateButtonLabel: string;
  generatedPathCount: number;
  generatedPathPointCount: number;
  generatedPathLength: number;
  onMeshUpload: (file: File | null) => void;
  onToggleFaceSelection: () => void;
  onAddPocketOperation: () => void;
  onEditSelectedOperation: () => void;
  onSelectOperation: (operationId: string) => void;
  onRemoveOperation: (operationId: string) => void;
  onGenerateOperation: () => void;
  canCancelGeneration: boolean;
  onCancelGeneration: () => void;
};

function getOperationSummary(operation: Pocket2DOperationConfig) {
  const vertexCount = operation.controlGeometry?.driveGeometry?.vertices?.length ?? 0;
  const bottomZ = operation.levels?.bottomZ;
  const topZ = operation.levels?.topZ;

  const zLabel =
    typeof topZ === "number" && typeof bottomZ === "number"
      ? `Z ${bottomZ.toFixed(2)} → ${topZ.toFixed(2)}`
      : "Z range not set";

  return `${vertexCount} pts · ${zLabel}`;
}

export function AppSidebar({
  meshLoaded,
  meshStatusLabel,
  meshCacheStatusLabel,
  faceSelectionMode,
  selectedMeshFace,
  operations,
  selectedOperationId,
  canGenerate,
  requestState,
  requestMessage,
  generateButtonLabel,
  generatedPathCount,
  generatedPathPointCount,
  generatedPathLength,
  onMeshUpload,
  onToggleFaceSelection,
  onAddPocketOperation,
  onEditSelectedOperation,
  onSelectOperation,
  onRemoveOperation,
  onGenerateOperation,
  canCancelGeneration,
  onCancelGeneration,
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
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            Selected face: {selectedMeshFace.label} · {selectedMeshFace.boundaryLoop?.length ?? 0} boundary points
          </p>
        ) : meshLoaded ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            No face selected. Pick a face that is coplanar to XY.
          </p>
        ) : null}

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-sm font-medium">Setup operations</div>
              <p className="text-xs leading-5 text-sidebar-foreground/65">
                Add and manage 2D pocket operations.
              </p>
            </div>

            <Button type="button" size="sm" onClick={onAddPocketOperation} disabled={!meshLoaded}>
              Add pocket
            </Button>
          </div>

          {operations.length > 0 ? (
            <div className="space-y-2">
              {operations.map((operation, index) => {
                const isSelected = operation.id === selectedOperationId;
                return (
                  <div
                    key={operation.id ?? `${operation.kind ?? "pocket2d"}-${index}`}
                    className={`rounded-md border p-2 ${isSelected ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <button
                      type="button"
                      className="w-full text-left"
                      onClick={() => {
                        if (operation.id) {
                          onSelectOperation(operation.id);
                        }
                      }}
                    >
                      <div className="text-sm font-medium">
                        {operation.displayName ?? `2D Pocket ${index + 1}`}
                      </div>
                      <div className="text-xs leading-5 text-sidebar-foreground/65">
                        {getOperationSummary(operation)}
                      </div>
                    </button>

                    <div className="mt-2 flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={onEditSelectedOperation}
                        disabled={!isSelected}
                      >
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (operation.id) {
                            onRemoveOperation(operation.id);
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-xs leading-5 text-sidebar-foreground/65">
              No operations yet. Select a face, then add a pocket operation.
            </p>
          )}
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            className="flex-1"
            disabled={!canGenerate || requestState === "submitting"}
            onClick={onGenerateOperation}
          >
            {generateButtonLabel}
          </Button>

          {canCancelGeneration ? (
            <Button type="button" variant="outline" onClick={onCancelGeneration}>
              Cancel
            </Button>
          ) : null}
        </div>

        {requestMessage ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">{requestMessage}</p>
        ) : (
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            Upload an STL, select one XY-coplanar face, add a pocket operation, then generate the toolpath and swept stock simulation.
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
