import { Check, ChevronDown, ChevronRight, LoaderCircle, X } from "lucide-react";

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
  status?: "not-generated" | "generating-gcode" | "generated" | "simulating" | "simulated";
};

function OperationStatusIcon({
  status,
}: {
  status: NonNullable<OperationTreeItemData["status"]>;
}) {
  const className = "ml-auto h-4 w-4 shrink-0";

  switch (status) {
    case "generating-gcode":
      return <LoaderCircle className={`${className} animate-spin text-green-500`} aria-label="Generating G-code" />;
    case "generated":
      return <Check className={`${className} text-green-500`} aria-label="G-code generated" />;
    case "simulating":
      return <LoaderCircle className={`${className} animate-spin text-blue-500`} aria-label="Simulating" />;
    case "simulated":
      return <Check className={`${className} text-blue-500`} aria-label="Simulation complete" />;
    default:
      return <X className={`${className} text-red-500`} aria-label="Not generated" />;
  }
}

type OperationTreeItemProps = TreeNodeRenderProps<OperationTreeItemData> & {
  onEdit: (operationId: string) => void;
  onRegenerate: (operationId: string) => void;
  onDelete: (operationId: string) => void;
  onSimulate: (operationId: string) => void;
  onCompare: (operationId: string) => void;
  onDownloadClData: (operationId: string) => void;
  onPostProcess: (operationId: string) => void;
  canManageOperations: boolean;
  simulatableOperationIds: ReadonlySet<string>;
  comparableOperationIds: ReadonlySet<string>;
  downloadableOperationIds: ReadonlySet<string>;
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
  onPostProcess,
  canManageOperations,
  simulatableOperationIds,
  comparableOperationIds,
  downloadableOperationIds,
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
        className={cn("h-7 items-center gap-1.5 border-border bg-background/90 py-1 shadow backdrop-blur")}
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
        <OperationStatusIcon status={node.data.status ?? "not-generated"} />
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
        <ContextMenuItem
          disabled={!downloadableOperationIds.has(operationId)}
          onSelect={() => onPostProcess(operationId)}
        >
          Post Process
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
