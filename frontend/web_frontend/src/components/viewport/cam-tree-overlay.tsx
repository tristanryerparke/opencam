import { useRef, useState } from "react";

import { AddOperationButton } from "opencam-react-ui/add-operation-button";
import { OperationContextMenu, PartContextMenu, SetupContextMenu } from "opencam-react-ui/context-menus";
import { Button } from "t-components/button";
import { OperationTree, type OperationTreeOperation } from "opencam-react-ui/operation-tree";
import { TreeView, type TreeNodeNested } from "opencam-react-ui/tree-view";
import { PartTreeItem, type PartTreeItemData } from "@/components/sidebar/part-tree-item";
import { useCamStore } from "@/state/cam-store";

export type RequestState = "idle" | "submitting" | "success" | "error";

type CamTreeOverlayProps = {
  simulatableOperationIds: ReadonlySet<string>;
  simulatedOperationIds: ReadonlySet<string>;
  comparableOperationIds: ReadonlySet<string>;
  downloadableOperationIds: ReadonlySet<string>;
  generatingOperationId: string | null;
  generatingOperationProgressPercent: number;
  isToolpathGenerating: boolean;
  isSimulationGenerating: boolean;
  onMeshUpload: (file: File | null) => void;
  onAddOperation: () => void;
  onEditOperation: (operationId: string) => void;
  onRegenerateOperation: (operationId: string) => void;
  onRegenerateSetup: () => void;
  onDuplicateOperation: (operationId: string) => void;
  onDeleteOperation: (operationId: string) => void;
  onReorderOperations: (operationIds: string[]) => void;
  onSimulateOperation: (operationId: string) => void;
  onCompareOperation: (operationId: string) => void;
  onPostProcessOperation: (operationId: string) => void;
  onPostProcessSetup: (label: string) => void;
  canManageOperations: boolean;
  canCancelGeneration: boolean;
  onCancelGeneration: () => void;
};

export function CamTreeOverlay({
  simulatableOperationIds,
  simulatedOperationIds,
  comparableOperationIds,
  downloadableOperationIds,
  generatingOperationId,
  isToolpathGenerating,
  isSimulationGenerating,
  onMeshUpload,
  onAddOperation,
  onEditOperation,
  onRegenerateOperation,
  onRegenerateSetup,
  onDuplicateOperation,
  onDeleteOperation,
  onReorderOperations,
  onSimulateOperation,
  onCompareOperation,
  onPostProcessOperation,
  onPostProcessSetup,
  canManageOperations,
  canCancelGeneration,
  onCancelGeneration,
}: CamTreeOverlayProps) {
  const meshName = useCamStore((state) => state.workspace.meshName);
  const meshUrl = useCamStore((state) => state.workspace.meshUrl);
  const operations = useCamStore((state) => state.workspace.operations);
  const meshLoaded = Boolean(meshUrl);
  const selectedNodeId = useCamStore((state) => state.selection.selectedTreeNodeId);
  const selectTreeNode = useCamStore((state) => state.actions.selectTreeNode);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [contextMenu, setContextMenu] = useState<
    | { kind: "part"; x: number; y: number }
    | { kind: "setup"; x: number; y: number }
    | { kind: "operation"; operationId: string; x: number; y: number }
    | null
  >(null);
  const partItems: TreeNodeNested<PartTreeItemData>[] = [{
    id: "part",
    data: { label: "Part", fileName: meshName ?? undefined, needsAttention: !meshLoaded },
  }];
  const operationItems: OperationTreeOperation[] = operations.flatMap((operation, index) => operation.id ? [{
    id: operation.id,
    label: operation.displayName ?? `Operation ${index + 1}`,
    status: simulatedOperationIds.has(operation.id)
      ? "simulated"
      : operation.id === generatingOperationId && isSimulationGenerating
        ? "simulating"
        : operation.id === generatingOperationId && isToolpathGenerating
          ? "generating-gcode"
          : downloadableOperationIds.has(operation.id)
            ? "generated"
            : "not-generated",
  }] : []);

  return (
    <section className="pointer-events-none absolute left-2 top-2 z-20 flex max-h-[calc(100%-1rem)] w-48 flex-col gap-1 overflow-y-auto">
        <input
          ref={fileInputRef}
          type="file"
          accept=".step,.stp"
          className="hidden"
          onChange={(event) => {
            onMeshUpload(event.target.files?.[0] ?? null);
            event.currentTarget.value = "";
          }}
        />

        <AddOperationButton
          className="pointer-events-auto"
          onClick={onAddOperation}
          disabled={!meshLoaded}
        />

        <div className="pointer-events-auto flex flex-col gap-1">
          <TreeView<PartTreeItemData>
            items={partItems}
            selectedIds={selectedNodeId === "part" ? ["part"] : []}
            onSelectedIdsChange={() => selectTreeNode("part")}
            renderNode={(props) => <PartTreeItem {...props} onContextMenu={(event) => { event.preventDefault(); selectTreeNode("part"); setContextMenu({ kind: "part", x: event.clientX, y: event.clientY }); }} />}
            aria-label="CAM part tree item"
          />
          <OperationTree
            setupId="setup-1"
            setupLabel="Setup 1"
            operations={operationItems}
            selectedId={selectedNodeId === "part" ? undefined : selectedNodeId}
            canReorder={canManageOperations}
            onSelect={selectTreeNode}
            onReorder={onReorderOperations}
            onSetupContextMenu={(event) => { event.preventDefault(); setContextMenu({ kind: "setup", x: event.clientX, y: event.clientY }); }}
            onOperationContextMenu={(operationId, event) => { event.preventDefault(); selectTreeNode(operationId); setContextMenu({ kind: "operation", operationId, x: event.clientX, y: event.clientY }); }}
          />
        </div>

        {contextMenu?.kind === "part" ? <PartContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          upload={{ run: () => fileInputRef.current?.click() }}
          remove={{ enabled: meshLoaded, run: () => void onMeshUpload(null) }}
        /> : null}
        {contextMenu?.kind === "setup" ? <SetupContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          regenerate={{ enabled: canManageOperations && operations.length > 0, run: onRegenerateSetup }}
          postProcess={{ enabled: operations.length > 0 && operationItems.every((operation) => downloadableOperationIds.has(operation.id)), run: () => onPostProcessSetup("Setup 1") }}
        /> : null}
        {contextMenu?.kind === "operation" ? <OperationContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          onClose={() => setContextMenu(null)}
          simulate={{ enabled: simulatableOperationIds.has(contextMenu.operationId), run: () => onSimulateOperation(contextMenu.operationId) }}
          compare={{ enabled: comparableOperationIds.has(contextMenu.operationId), run: () => onCompareOperation(contextMenu.operationId) }}
          postProcess={{ enabled: downloadableOperationIds.has(contextMenu.operationId), run: () => onPostProcessOperation(contextMenu.operationId) }}
          edit={{ enabled: canManageOperations, run: () => onEditOperation(contextMenu.operationId) }}
          regenerate={{ enabled: canManageOperations, run: () => onRegenerateOperation(contextMenu.operationId) }}
          duplicate={{ enabled: canManageOperations, run: () => onDuplicateOperation(contextMenu.operationId) }}
          delete={{ enabled: canManageOperations, run: () => onDeleteOperation(contextMenu.operationId) }}
        /> : null}

        {canCancelGeneration ? (
          <Button
            type="button"
            variant="outline"
            className="pointer-events-auto bg-background/90 shadow backdrop-blur"
            onClick={onCancelGeneration}
          >
            {isSimulationGenerating ? "Cancel simulation" : "Cancel generation"}
          </Button>
        ) : null}
    </section>
  );
}
