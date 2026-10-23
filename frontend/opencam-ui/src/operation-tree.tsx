import type { MouseEvent, ReactNode } from "react";

import { TreeView, type TreeNodeNested, type TreeNodeRenderProps } from "./tree-view/tree-view";

export type OperationTreeStatus = "not-generated" | "generating-gcode" | "generated" | "simulating" | "simulated" | "invalid";
export type OperationTreeOperation = { id: string; label: string; status: OperationTreeStatus };
type NodeData = { kind: "setup" | "operation"; label: string; operation?: OperationTreeOperation };

type Props = {
  setupId: string;
  setupLabel: string;
  operations: readonly OperationTreeOperation[];
  selectedId?: string;
  canReorder?: boolean;
  onSelect: (id: string) => void;
  onReorder: (operationIds: string[]) => void;
  onOperationContextMenu?: (operationId: string, event: MouseEvent) => void;
  onSetupContextMenu?: (event: MouseEvent) => void;
  wrapOperation?: (operationId: string, content: ReactNode) => ReactNode;
  wrapSetup?: (content: ReactNode) => ReactNode;
  className?: string;
};

function SvgIcon({ children, className = "h-4 w-4" }: { children: ReactNode; className?: string }) {
  return <svg className={`tree-icon ${className} shrink-0`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}

function StatusIcon({ status }: { status: OperationTreeStatus }) {
  const visualStatus = status === "generating-gcode" || status === "simulating" ? "generating" : status === "generated" ? "generated" : status === "simulated" ? "simulated" : status === "invalid" ? "invalid" : "missing";
  const icon = status === "generating-gcode" || status === "simulating"
    ? <SvgIcon className={`tree-icon h-4 w-4 animate-spin ${status === "simulating" ? "text-blue-500" : "text-green-500"}`}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></SvgIcon>
    : status === "generated" || status === "simulated"
      ? <SvgIcon className={`tree-icon h-4 w-4 ${status === "simulated" ? "text-blue-500" : "text-green-500"}`}><path d="m5 12 4 4L19 6" /></SvgIcon>
      : <SvgIcon className="tree-icon h-4 w-4 text-red-500"><path d="m6 6 12 12M18 6 6 18" /></SvgIcon>;
  return <span className={`tree-status ${visualStatus} ml-auto h-4 w-4 shrink-0`}>{icon}</span>;
}

function SetupRow(props: TreeNodeRenderProps<NodeData> & { onContextMenu?: (event: MouseEvent) => void }) {
  const content = <div className="w-full" onContextMenu={props.onContextMenu}>
    <button type="button" data-active={props.isSelected} className={`tree-row ${props.isSelected ? "selected" : ""} flex h-7 w-full items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-left text-xs text-foreground shadow data-[active=true]:!border-blue-500`} onClick={(event) => { event.stopPropagation(); props.select(event); }}>
      <SvgIcon><path d="M5 3v16h16" /><path d="m5 19 6-6" /><path d="m2 6 3-3 3 3" /><path d="m18 16 3 3-3 3" /></SvgIcon>
      <span className="tree-content flex min-w-0 flex-1 items-center gap-1.5 font-medium"><span className="tree-label truncate">{props.node.data.label}</span></span>
      <span className="flex h-4 w-4 shrink-0 items-center justify-center" onClick={(event) => { event.stopPropagation(); props.toggle(); }}>
        <SvgIcon className="h-3.5 w-3.5">{props.isExpanded ? <path d="m6 9 6 6 6-6" /> : <path d="m9 18 6-6-6-6" />}</SvgIcon>
      </span>
    </button>
  </div>;
  return content;
}

function OperationRow(props: TreeNodeRenderProps<NodeData> & { onContextMenu?: (operationId: string, event: MouseEvent) => void }) {
  const operation = props.node.data.operation!;
  return <div className="tree-operation flex w-full items-center gap-1" style={{ paddingLeft: props.depth * 8, border: 0, background: "transparent", boxShadow: "none" }} onContextMenu={(event) => props.onContextMenu?.(operation.id, event)}>
    <button ref={props.dragHandleRef} type="button" aria-label={`Reorder ${operation.label}`} className="tree-drag-handle flex h-7 w-4 shrink-0 cursor-grab items-center justify-center border-0 bg-transparent p-0 text-sidebar-foreground/65 hover:text-sidebar-foreground active:cursor-grabbing" style={{ appearance: "none", border: 0, borderRadius: 0, outline: 0, boxShadow: "none", background: "transparent", padding: 0 }} onClick={(event) => event.stopPropagation()}>
      <SvgIcon><circle cx="9" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none" /><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none" /></SvgIcon>
    </button>
    <button type="button" data-active={props.isSelected} className={`tree-row ${props.isSelected ? "selected" : ""} flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1 text-left text-xs text-foreground shadow data-[active=true]:!border-blue-500`} onClick={(event) => { event.stopPropagation(); props.select(event); }}>
      <span className="tree-content flex min-w-0 flex-1 items-center gap-1.5 font-medium"><span className="tree-label truncate">{operation.label}</span></span>
      <StatusIcon status={operation.status} />
    </button>
  </div>;
}

export function OperationTree({ setupId, setupLabel, operations, selectedId, canReorder = true, onSelect, onReorder, onOperationContextMenu, onSetupContextMenu, wrapOperation, wrapSetup, className }: Props) {
  const items: TreeNodeNested<NodeData>[] = [{ id: setupId, data: { kind: "setup", label: setupLabel }, isGroup: true, children: operations.map((operation) => ({ id: operation.id, data: { kind: "operation", label: operation.label, operation } })) }];
  return <TreeView<NodeData>
    items={items}
    defaultExpandedIds={[setupId]}
    selectedIds={selectedId ? [selectedId] : []}
    onSelectedIdsChange={(ids) => onSelect(ids.at(-1) ?? setupId)}
    draggable={canReorder}
    droppable={canReorder}
    showGuideLines={false}
    canDrag={(node) => node.parentId === setupId}
    canDrop={(event) => event.source.parentId === setupId && event.target.parentId === setupId && event.projectedDepth === 1}
    onItemsChange={(next) => {
      const ids = next[0]?.children?.map((child) => child.data.operation?.id).filter((id): id is string => Boolean(id)) ?? [];
      if (ids.length === operations.length) onReorder(ids);
    }}
    className={`opencam-operation-tree ${className ?? ""}`}
    renderNode={(props) => {
      if (props.node.data.kind === "setup") {
        const content = <SetupRow {...props} onContextMenu={onSetupContextMenu} />;
        return wrapSetup ? wrapSetup(content) : content;
      }
      const operationId = props.node.data.operation!.id;
      const content = <OperationRow {...props} onContextMenu={onOperationContextMenu} />;
      return wrapOperation ? wrapOperation(operationId, content) : content;
    }}
  />;
}
