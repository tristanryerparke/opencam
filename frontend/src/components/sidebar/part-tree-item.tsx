import { ChevronDown, ChevronRight, SquareRoundCorner } from "lucide-react";

import { SidebarMenuButton } from "t-components/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import type { OperationTreeItemData } from "@/components/sidebar/operation-tree-item";
import { cn } from "@/lib/utils";

type PartTreeItemProps = TreeNodeRenderProps<OperationTreeItemData> & {
  onUpload: () => void;
  onDelete: () => void;
  canDelete: boolean;
};

export function PartTreeItem({
  node,
  isExpanded,
  isSelected,
  depth,
  hasChildren,
  toggle,
  select,
  onUpload,
  onDelete,
  canDelete,
}: PartTreeItemProps) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
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
            <SquareRoundCorner className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              <span className="shrink-0">{node.data.label}</span>
              {node.data.fileName ? (
                <span className="min-w-0 flex-1 truncate text-xs font-normal text-sidebar-foreground/65">{node.data.fileName}</span>
              ) : null}
            </span>
            {node.data.needsAttention ? (
              <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" aria-label="Needs STEP file" />
            ) : null}
            {hasChildren ? (
              <span
                className="flex h-4 w-4 shrink-0 items-center justify-center"
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
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onUpload}>Upload STEP file…</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" disabled={!canDelete} onSelect={onDelete}>
          Delete current STEP file
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
