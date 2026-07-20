import { useRef } from "react";
import { ChevronDown, ChevronRight, Folders, SquareRoundCorner } from "lucide-react";

import { Button } from "t-components/button";
import { Sidebar, SidebarContent, SidebarMenuButton } from "t-components/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { TreeView, type TreeNodeNested, type TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import type { Operation } from "@/lib/cam-schema";
import { cn } from "@/lib/utils";

export type RequestState = "idle" | "submitting" | "success" | "error";

type OperationTreeItem = {
  label: string;
  operationId?: string;
  fileName?: string;
  needsAttention?: boolean;
  progressPercent?: number;
};

type AppSidebarProps = {
  meshLoaded: boolean;
  meshName: string | null;
  operations: Operation[];
  selectedNodeId: string;
  simulatableOperationIds: ReadonlySet<string>;
  comparableOperationIds: ReadonlySet<string>;
  downloadableOperationIds: ReadonlySet<string>;
  generatingOperationId: string | null;
  generatingOperationProgressPercent: number;
  onMeshUpload: (file: File | null) => void;
  onAddOperation: () => void;
  onSelectNode: (nodeId: string) => void;
  onEditOperation: (operationId: string) => void;
  onDeleteOperation: (operationId: string) => void;
  onSimulateOperation: (operationId: string) => void;
  onCompareOperation: (operationId: string) => void;
  onDownloadOperationClData: (operationId: string) => void;
  canManageOperations: boolean;
  canCancelGeneration: boolean;
  onCancelGeneration: () => void;
};

function renderTreeNode(
  {
    node,
    isExpanded,
    isSelected,
    depth,
    hasChildren,
    toggle,
    select,
  }: TreeNodeRenderProps<OperationTreeItem>,
  onUploadPart: () => void,
  onDeletePart: () => void,
  canDeletePart: boolean,
  onEditOperation: (operationId: string) => void,
  onDeleteOperation: (operationId: string) => void,
  onSimulateOperation: (operationId: string) => void,
  onCompareOperation: (operationId: string) => void,
  onDownloadOperationClData: (operationId: string) => void,
  canManageOperations: boolean,
  simulatableOperationIds: ReadonlySet<string>,
  comparableOperationIds: ReadonlySet<string>,
  downloadableOperationIds: ReadonlySet<string>,
) {
  const operationId = node.data.operationId;
  const content = (
    <div
      className="w-full"
      style={{ paddingLeft: depth * 16 }}
      onClick={(event) => {
        event.stopPropagation();
        select(event);
      }}
    >
      <SidebarMenuButton
        type="button"
        isActive={isSelected}
        className={cn("h-auto items-center gap-1.5 py-1")}
        onClick={(event) => {
          event.stopPropagation();
          select(event);
        }}
      >
        {node.id === "part" ? (
          <SquareRoundCorner className="mt-0.5 h-4 w-4 shrink-0" />
        ) : node.id === "setup-1" ? (
          <Folders className="mt-0.5 h-4 w-4 shrink-0" />
        ) : null}
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          <span className="truncate">{node.data.label}</span>
          {node.data.fileName ? (
            <span className="truncate text-xs font-normal text-sidebar-foreground/65">{node.data.fileName}</span>
          ) : null}
        </span>
        {node.data.progressPercent != null ? (
          <span className="ml-auto shrink-0 text-xs tabular-nums text-sidebar-foreground/65">
            {Math.round(node.data.progressPercent)}%
          </span>
        ) : node.data.needsAttention ? (
          <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Needs STEP file" />
        ) : null}
        {hasChildren ? (
          <span
            className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        ) : null}
      </SidebarMenuButton>
    </div>
  );

  if (node.id === "part") {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onUploadPart}>Upload STEP file…</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem variant="destructive" disabled={!canDeletePart} onSelect={onDeletePart}>
            Delete current STEP file
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  }

  if (node.isGroup || !operationId) {
    return content;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!simulatableOperationIds.has(operationId)} onSelect={() => onSimulateOperation(operationId)}>
          Simulate
        </ContextMenuItem>
        <ContextMenuItem disabled={!comparableOperationIds.has(operationId)} onSelect={() => onCompareOperation(operationId)}>
          Compare
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!downloadableOperationIds.has(operationId)}
          onSelect={() => onDownloadOperationClData(operationId)}
        >
          Download CL JSON
        </ContextMenuItem>
        <ContextMenuItem disabled={!canManageOperations} onSelect={() => onEditOperation(operationId)}>
          Edit operation
        </ContextMenuItem>
        <ContextMenuItem
          variant="destructive"
          disabled={!canManageOperations}
          onSelect={() => onDeleteOperation(operationId)}
        >
          Delete operation
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function AppSidebar({
  meshLoaded,
  meshName,
  operations,
  selectedNodeId,
  simulatableOperationIds,
  comparableOperationIds,
  downloadableOperationIds,
  generatingOperationId,
  generatingOperationProgressPercent,
  onMeshUpload,
  onAddOperation,
  onSelectNode,
  onEditOperation,
  onDeleteOperation,
  onSimulateOperation,
  onCompareOperation,
  onDownloadOperationClData,
  canManageOperations,
  canCancelGeneration,
  onCancelGeneration,
}: AppSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const treeItems: TreeNodeNested<OperationTreeItem>[] = [
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
            operation.id && operation.id === generatingOperationId ? generatingOperationProgressPercent : undefined,
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

        <TreeView<OperationTreeItem>
          items={treeItems}
          defaultExpandedIds={["setup-1"]}
          selectedIds={[selectedNodeId]}
          onSelectedIdsChange={(ids) => onSelectNode(ids.at(-1) ?? "setup-1")}
          renderNode={(props) =>
            renderTreeNode(
              props,
              () => fileInputRef.current?.click(),
              () => void onMeshUpload(null),
              meshLoaded,
              onEditOperation,
              onDeleteOperation,
              onSimulateOperation,
              onCompareOperation,
              onDownloadOperationClData,
              canManageOperations,
              simulatableOperationIds,
              comparableOperationIds,
              downloadableOperationIds,
            )}
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
