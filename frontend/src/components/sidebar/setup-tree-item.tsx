import { ChevronDown, ChevronRight, Move3d } from "lucide-react";

import { SidebarMenuButton } from "t-components/sidebar";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import type { OperationTreeItemData } from "@/components/sidebar/operation-tree-item";
import { cn } from "@/lib/utils";

type SetupTreeItemProps = TreeNodeRenderProps<OperationTreeItemData> & {
  onPostProcess: (label: string) => void;
  canPostProcess: boolean;
};

export function SetupTreeItem({
  node,
  isExpanded,
  isSelected,
  depth,
  hasChildren,
  toggle,
  select,
  onPostProcess,
  canPostProcess,
}: SetupTreeItemProps) {
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
            <Move3d className="h-4 w-4 shrink-0" />
            <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
              <span className="truncate">{node.data.label}</span>
            </span>
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
        <ContextMenuItem disabled={!canPostProcess} onSelect={() => onPostProcess(node.data.label)}>
          Post Process
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
