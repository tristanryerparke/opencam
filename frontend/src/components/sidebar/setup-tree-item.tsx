import { ChevronDown, ChevronRight, Folders } from "lucide-react";

import { SidebarMenuButton } from "t-components/sidebar";
import type { TreeNodeRenderProps } from "@/components/tree-view/tree-view";
import type { OperationTreeItemData } from "@/components/sidebar/operation-tree-item";
import { cn } from "@/lib/utils";

type SetupTreeItemProps = TreeNodeRenderProps<OperationTreeItemData>;

export function SetupTreeItem({
  node,
  isExpanded,
  isSelected,
  depth,
  hasChildren,
  toggle,
  select,
}: SetupTreeItemProps) {
  return (
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
        <Folders className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 font-medium">
          <span className="truncate">{node.data.label}</span>
        </span>
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
}
