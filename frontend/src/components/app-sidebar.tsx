import { useRef } from "react";

import { Button } from "t-components/button";
import { Sidebar, SidebarContent } from "t-components/sidebar";
import { TreeView, type TreeNodeNested } from "@/components/tree-view/tree-view";
import { OperationTreeItem, type OperationTreeItemData } from "@/components/sidebar/operation-tree-item";
import { PartTreeItem } from "@/components/sidebar/part-tree-item";
import { SetupTreeItem } from "@/components/sidebar/setup-tree-item";
import { useCamStore } from "@/state/cam-store";

export type RequestState = "idle" | "submitting" | "success" | "error";

type AppSidebarProps = {
  simulatableOperationIds: ReadonlySet<string>;
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
  onDeleteOperation: (operationId: string) => void;
  onSimulateOperation: (operationId: string) => void;
  onCompareOperation: (operationId: string) => void;
  onDownloadOperationClData: (operationId: string) => void;
  canManageOperations: boolean;
  canCancelGeneration: boolean;
  onCancelGeneration: () => void;
};

export function AppSidebar({
  simulatableOperationIds,
  comparableOperationIds,
  downloadableOperationIds,
  generatingOperationId,
  generatingOperationProgressPercent,
  isToolpathGenerating,
  isSimulationGenerating,
  onMeshUpload,
  onAddOperation,
  onEditOperation,
  onRegenerateOperation,
  onDeleteOperation,
  onSimulateOperation,
  onCompareOperation,
  onDownloadOperationClData,
  canManageOperations,
  canCancelGeneration,
  onCancelGeneration,
}: AppSidebarProps) {
  const meshName = useCamStore((state) => state.workspace.meshName);
  const meshUrl = useCamStore((state) => state.workspace.meshUrl);
  const operations = useCamStore((state) => state.workspace.operations);
  const meshLoaded = Boolean(meshUrl);
  const selectedNodeId = useCamStore((state) => state.selection.selectedTreeNodeId);
  const selectTreeNode = useCamStore((state) => state.actions.selectTreeNode);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const treeItems: TreeNodeNested<OperationTreeItemData>[] = [
    {
      id: "part",
      data: {
        label: "Part",
        fileName: meshName ?? undefined,
        needsAttention: !meshLoaded,
      },
    },
    {
      id: "setup-1",
      data: { label: "Setup 1" },
      isGroup: true,
      children: operations.map((operation, index) => ({
        id: operation.id ?? `operation-${index}`,
        data: {
          label: operation.displayName ?? `Operation ${index + 1}`,
          operationId: operation.id,
          progressPercent:
            operation.id &&
            (operation.id === generatingOperationId || (isToolpathGenerating && operation.id === selectedNodeId))
              ? generatingOperationProgressPercent
              : undefined,
          simulationComplete: operation.id ? comparableOperationIds.has(operation.id) : false,
        },
      })),
    },
  ];

  return (
    <Sidebar>
      <SidebarContent className="gap-3 p-2">
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

        <Button type="button" className="w-full" onClick={onAddOperation} disabled={!meshLoaded}>
          Add Operation
        </Button>

        <TreeView<OperationTreeItemData>
          items={treeItems}
          defaultExpandedIds={["setup-1"]}
          selectedIds={[selectedNodeId]}
          onSelectedIdsChange={(ids) => selectTreeNode(ids.at(-1) ?? "setup-1")}
          renderNode={(props) => {
            if (props.node.id === "part") {
              return (
                <PartTreeItem
                  {...props}
                  onUpload={() => fileInputRef.current?.click()}
                  onDelete={() => void onMeshUpload(null)}
                  canDelete={meshLoaded}
                />
              );
            }

            if (props.node.id === "setup-1") {
              return <SetupTreeItem {...props} />;
            }

            return (
              <OperationTreeItem
                {...props}
                onEdit={onEditOperation}
                onRegenerate={onRegenerateOperation}
                onDelete={onDeleteOperation}
                onSimulate={onSimulateOperation}
                onCompare={onCompareOperation}
                onDownloadClData={onDownloadOperationClData}
                canManageOperations={canManageOperations}
                simulatableOperationIds={simulatableOperationIds}
                comparableOperationIds={comparableOperationIds}
                downloadableOperationIds={downloadableOperationIds}
                isSimulationGenerating={isSimulationGenerating}
              />
            );
          }}
          aria-label="CAM setup tree"
        />

        {canCancelGeneration ? (
          <Button type="button" variant="outline" onClick={onCancelGeneration}>
            Cancel generation
          </Button>
        ) : null}
      </SidebarContent>
    </Sidebar>
  );
}
