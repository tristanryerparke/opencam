import { useEffect } from "react";

export type MenuAction = { enabled?: boolean; run: () => void };
export type MenuPosition = { x: number; y: number };

type BaseProps = MenuPosition & { onClose: () => void };
export type OperationContextMenuProps = BaseProps & {
  simulate: MenuAction;
  compare?: MenuAction;
  postProcess: MenuAction;
  edit: MenuAction;
  regenerate: MenuAction;
  duplicate: MenuAction;
  delete: MenuAction;
};
export type SetupContextMenuProps = BaseProps & {
  regenerate: MenuAction;
  postProcess: MenuAction;
};
export type PartContextMenuProps = BaseProps & {
  upload?: MenuAction;
  remove: MenuAction;
};

function Menu({ x, y, onClose, items }: BaseProps & { items: readonly { label: string; action: MenuAction; destructive?: boolean }[] }) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("blur", close);
    document.addEventListener("pointerdown", close);
    return () => { window.removeEventListener("blur", close); document.removeEventListener("pointerdown", close); };
  }, [onClose]);
  return <div data-slot="opencam-context-menu" className="opencam-context-menu" onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()} style={{ left: x, top: y }}>
    {items.map(({ label, action, destructive }) => <button key={label} type="button" data-slot="opencam-context-menu-item" data-destructive={destructive || undefined} disabled={action.enabled === false} onClick={() => { action.run(); onClose(); }}>{label}</button>)}
  </div>;
}

export function OperationContextMenu(props: OperationContextMenuProps) {
  const items = [
    { label: "Simulate", action: props.simulate },
    ...(props.compare ? [{ label: "Compare", action: props.compare }] : []),
    { label: "Post Process", action: props.postProcess },
    { label: "Edit operation", action: props.edit },
    { label: "Regenerate", action: props.regenerate },
    { label: "Duplicate", action: props.duplicate },
    { label: "Delete operation", action: props.delete, destructive: true },
  ];
  return <Menu {...props} items={items} />;
}

export function SetupContextMenu(props: SetupContextMenuProps) {
  return <Menu {...props} items={[
    { label: "Regenerate", action: props.regenerate },
    { label: "Post Process", action: props.postProcess },
  ]} />;
}

export function PartContextMenu(props: PartContextMenuProps) {
  return <Menu {...props} items={[
    ...(props.upload ? [{ label: "Upload STEP file…", action: props.upload }] : []),
    { label: "Remove reference", action: props.remove, destructive: true },
  ]} />;
}
