import { ChevronDown, ChevronRight } from "lucide-react";

import { SidebarMenuButton } from "t-components/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import { cn } from "@/lib/utils";

export type OperationTreeItemData = {
  label: string;
  operationId?: string;
  fileName?: string;
  needsAttention?: boolean;
  progressPercent?: number;
  simulationComplete?: boolean;
};

type OperationTreeItemProps = TreeNodeRenderProps<OperationTreeItemData> & {
  onEdit: (operationId: string) => void;
  onRegenerate: (operationId: string) => void;
  onDelete: (operationId: string) => void;
  onSimulate: (operationId: string) => void;
  onCompare: (operationId: string) => void;
  onDownloadClData: (operationId: string) => void;
  canManageOperations: boolean;
  simulatableOperationIds: ReadonlySet<string>;
  comparableOperationIds: ReadonlySet<string>;
  downloadableOperationIds: ReadonlySet<string>;
  isSimulationGenerating: boolean;
};

export function OperationTreeItem({
  node,
  isExpanded,
  isSelected,
  depth,
  hasChildren,
  toggle,
  select,
  onEdit,
  onRegenerate,
  onDelete,
  onSimulate,
  onCompare,
  onDownloadClData,
  canManageOperations,
  simulatableOperationIds,
  comparableOperationIds,
  downloadableOperationIds,
  isSimulationGenerating,
}: OperationTreeItemProps) {
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
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          <span className="truncate">{node.data.label}</span>
          {node.data.fileName ? (
            <span className="truncate text-xs font-normal text-sidebar-foreground/65">{node.data.fileName}</span>
          ) : null}
        </span>
        {node.data.simulationComplete ? (
          <span className="ml-auto shrink-0 text-xs text-sidebar-foreground/65">Simulated</span>
        ) : node.data.progressPercent != null ? (
          <span className="ml-auto shrink-0 text-xs tabular-nums text-sidebar-foreground/65">
            {isSimulationGenerating ? `Simulating ${Math.round(node.data.progressPercent)}%` : "Generating"}
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

  if (!operationId) {
    return content;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{content}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!simulatableOperationIds.has(operationId)} onSelect={() => onSimulate(operationId)}>
          Simulate
        </ContextMenuItem>
        <ContextMenuItem disabled={!comparableOperationIds.has(operationId)} onSelect={() => onCompare(operationId)}>
          Compare
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!downloadableOperationIds.has(operationId)}
          onSelect={() => onDownloadClData(operationId)}
        >
          Download CL JSON
        </ContextMenuItem>
        <ContextMenuItem disabled={!canManageOperations} onSelect={() => onEdit(operationId)}>
          Edit operation
        </ContextMenuItem>
        <ContextMenuItem disabled={!canManageOperations} onSelect={() => onRegenerate(operationId)}>
          Regenerate
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" disabled={!canManageOperations} onSelect={() => onDelete(operationId)}>
          Delete operation
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
