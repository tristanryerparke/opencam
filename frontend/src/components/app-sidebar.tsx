import { ChevronDown, ChevronRight, Folder, Milestone } from "lucide-react";

import { Button } from "t-components/button";
import { Input } from "t-components/input";
import { Label } from "t-components/label";
import { Sidebar, SidebarContent, SidebarMenuButton } from "t-components/sidebar";
import { TreeView, type TreeNodeNested, type TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import { type Pocketing2DOp as Operation } from "@/generated_schemas/cam";
import { cn } from "@/lib/utils";

export type RequestState = "idle" | "submitting" | "success" | "error";

type OperationTreeItem = {
  label: string;
  summary?: string;
  operationId?: string;
};

type AppSidebarProps = {
  meshLoaded: boolean;
  meshStatusLabel: string;
  meshCacheStatusLabel: string;
  operations: Operation[];
  selectedNodeId: string;
  requestState: RequestState;
  requestMessage: string;
  generatedPathCount: number;
  generatedPathPointCount: number;
  generatedPathLength: number;
  onMeshUpload: (file: File | null) => void;
  onAddOperation: () => void;
  onSelectNode: (nodeId: string) => void;
  canCancelGeneration: boolean;
  onCancelGeneration: () => void;
};

function getOperationSummary(operation: Operation) {
  const depthOfCut = operation.levels?.depthOfCut;
  return typeof depthOfCut === "number"
    ? `Cut depth ${depthOfCut.toFixed(2)} mm`
    : "Cut depth not set";
}

function renderTreeNode({
  node,
  isExpanded,
  isSelected,
  depth,
  hasChildren,
  toggle,
  select,
}: TreeNodeRenderProps<OperationTreeItem>) {
  return (
    <SidebarMenuButton
      type="button"
      isActive={isSelected}
      className={cn("h-auto items-start gap-1.5 py-1")}
      style={{ paddingLeft: depth * 16 + 8 }}
      onClick={(event) => {
        event.stopPropagation();
        if (hasChildren) {
          toggle();
        }
        select(event);
      }}
    >
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
        {hasChildren ? (
          isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
        ) : null}
      </span>
      {node.isGroup ? <Folder className="mt-0.5 h-4 w-4 shrink-0" /> : <Milestone className="mt-0.5 h-4 w-4 shrink-0" />}
      <span className="min-w-0">
        <span className="block truncate font-medium">{node.data.label}</span>
        {node.data.summary ? (
          <span className="block truncate text-xs text-sidebar-foreground/65">{node.data.summary}</span>
        ) : null}
      </span>
    </SidebarMenuButton>
  );
}

export function AppSidebar({
  meshLoaded,
  meshStatusLabel,
  meshCacheStatusLabel,
  operations,
  selectedNodeId,
  requestState,
  requestMessage,
  generatedPathCount,
  generatedPathPointCount,
  generatedPathLength,
  onMeshUpload,
  onAddOperation,
  onSelectNode,
  canCancelGeneration,
  onCancelGeneration,
}: AppSidebarProps) {
  const treeItems: TreeNodeNested<OperationTreeItem>[] = [
    {
      id: "setup-1",
      data: { label: "Setup 1" },
      isGroup: true,
      children: operations.map((operation, index) => ({
        id: operation.id ?? `operation-${index}`,
        data: {
          label: operation.displayName ?? `2.5D Pocketing ${index + 1}`,
          summary: getOperationSummary(operation),
          operationId: operation.id,
        },
      })),
    },
  ];

  return (
    <Sidebar>
      <SidebarContent className="gap-3 p-2">
        <div className="space-y-1">
          <Label htmlFor="mesh-upload">Upload STL</Label>
          <Input
            id="mesh-upload"
            type="file"
            accept=".stl,model/stl"
            className="py-0 file:h-full file:py-0"
            onChange={(event) => onMeshUpload(event.target.files?.[0] ?? null)}
          />
        </div>

        <p className="text-xs leading-5 text-sidebar-foreground/65">{meshStatusLabel}</p>

        {meshCacheStatusLabel ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">{meshCacheStatusLabel}</p>
        ) : null}

        <div className="space-y-2 rounded-md border p-2">
          <Button type="button" className="w-full" onClick={onAddOperation} disabled={!meshLoaded}>
            Add Operation
          </Button>

          <TreeView<OperationTreeItem>
            items={treeItems}
            defaultExpandedIds={["setup-1"]}
            selectedIds={[selectedNodeId]}
            onSelectedIdsChange={(ids) => onSelectNode(ids.at(-1) ?? "setup-1")}
            renderNode={renderTreeNode}
            aria-label="CAM setup tree"
          />
        </div>

        {requestState === "submitting" && canCancelGeneration ? (
          <Button type="button" variant="outline" onClick={onCancelGeneration}>
            Cancel generation
          </Button>
        ) : null}

        {requestMessage ? (
          <p className="text-xs leading-5 text-sidebar-foreground/65">{requestMessage}</p>
        ) : (
          <p className="text-xs leading-5 text-sidebar-foreground/65">
            Upload an STL, add an operation, choose XY-coplanar control geometry, then generate.
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
