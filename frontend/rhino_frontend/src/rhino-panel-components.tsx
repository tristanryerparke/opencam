import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { AddOperationButton } from "opencam-react-ui/add-operation-button";
import { OperationContextMenu, PartContextMenu, SetupContextMenu } from "opencam-react-ui/context-menus";
import { OperationTree, type OperationTreeStatus } from "opencam-react-ui/operation-tree";
import { VisibilityPicker } from "opencam-react-ui/visibility-picker";

type Operation = { id: string; name: string; type: string };
type Setup = { id: string; name: string; operations: Operation[] };
type Status = { className: string; label: string };
type OperationTreeProps = {
  setup: Setup;
  selectedOperationId?: string;
  statusFor: (operation: Operation) => Status;
  onSelect: (operationId: string) => void;
  onOperationContextMenu: (operationId: string, event: MouseEvent) => void;
  onSetupContextMenu: (event: MouseEvent) => void;
  onReorder: (operationIds: string[]) => void;
};

const roots = new WeakMap<HTMLElement, Root>();
const statusMap: Record<string, OperationTreeStatus> = {
  generating: "generating-gcode",
  simulated: "simulated",
  generated: "generated",
  invalid: "invalid",
  missing: "not-generated",
};

function rootFor(element: HTMLElement) {
  const root = roots.get(element) ?? createRoot(element);
  roots.set(element, root);
  return root;
}

export function mountRhinoAddOperationButton(element: HTMLElement, disabled: boolean, onClick: () => void) {
  flushSync(() => rootFor(element).render(<AddOperationButton disabled={disabled} onClick={onClick} />));
}

export function mountRhinoOperationTree(element: HTMLElement, props: OperationTreeProps) {
  flushSync(() => rootFor(element).render(<OperationTree
    setupId={props.setup.id}
    setupLabel={props.setup.name}
    operations={props.setup.operations.map((operation) => ({ id: operation.id, label: operation.name, status: statusMap[props.statusFor(operation).className] ?? "not-generated" }))}
    selectedId={props.selectedOperationId}
    onSelect={(id) => { if (id !== props.setup.id) props.onSelect(id); }}
    onOperationContextMenu={props.onOperationContextMenu}
    onSetupContextMenu={props.onSetupContextMenu}
    onReorder={props.onReorder}
  />));
}

export type RhinoContextMenu =
  | { kind: "operation"; operationId: string; x: number; y: number }
  | { kind: "setup"; setupId: string; x: number; y: number }
  | { kind: "part"; x: number; y: number };

type ContextMenuActions = {
  close: () => void;
  operationGenerated: boolean;
  setupHasOperations: boolean;
  setupGenerated: boolean;
  busy: boolean;
  simulate: () => void;
  postProcess: () => void;
  edit: () => void;
  regenerate: () => void;
  duplicate: () => void;
  delete: () => void;
  regenerateSetup: () => void;
  postProcessSetup: () => void;
  removePart: () => void;
};

export function mountRhinoContextMenu(element: HTMLElement, menu: RhinoContextMenu | undefined, actions: ContextMenuActions) {
  const component = !menu ? null : menu.kind === "part"
    ? <PartContextMenu x={menu.x} y={menu.y} onClose={actions.close} remove={{ run: actions.removePart }} />
    : menu.kind === "setup"
      ? <SetupContextMenu x={menu.x} y={menu.y} onClose={actions.close} regenerate={{ enabled: actions.setupHasOperations && !actions.busy, run: actions.regenerateSetup }} postProcess={{ enabled: actions.setupGenerated && !actions.busy, run: actions.postProcessSetup }} />
      : <OperationContextMenu x={menu.x} y={menu.y} onClose={actions.close} simulate={{ enabled: actions.operationGenerated && !actions.busy, run: actions.simulate }} postProcess={{ enabled: actions.operationGenerated && !actions.busy, run: actions.postProcess }} edit={{ enabled: !actions.busy, run: actions.edit }} regenerate={{ enabled: !actions.busy, run: actions.regenerate }} duplicate={{ enabled: !actions.busy, run: actions.duplicate }} delete={{ enabled: !actions.busy, run: actions.delete }} />;
  flushSync(() => rootFor(element).render(component));
}

export function mountRhinoVisibilityPicker(element: HTMLElement, visibility: Record<string, boolean>, toolEnabled: boolean, onChange: (flag: string, value: boolean) => void) {
  flushSync(() => rootFor(element).render(<VisibilityPicker
    value={{ stock: visibility.stock !== false, part: visibility.part !== false, toolpath: visibility.toolpath !== false, tool: visibility.tool !== false }}
    toolEnabled={toolEnabled}
    expand
    onChange={(key, value) => onChange(key, value)}
  />));
}
