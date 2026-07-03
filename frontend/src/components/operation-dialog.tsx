import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar";
import {
  type DraftObject,
  type DraftValue,
  type JsonSchema,
  getSchemaTitle,
  getUiMetadata,
  getVisibleSections,
  parsePocketOperationDraft,
  resolveSchema,
  setDraftValueAtPath,
} from "@/lib/cam-schema";

const SELECT_CLASSNAME =
  "border-input focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:ring-[3px]";

function formatReadOnlyValue(value: DraftValue | undefined) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return "—";
}

function GeometrySummary({ value }: { value: DraftValue | undefined }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return <p className="text-sm text-muted-foreground">No drive geometry captured yet.</p>;
  }

  const geometry = value as {
    selectionLabel?: string | null;
    planeZ?: number;
    vertices?: Array<unknown>;
  };

  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <div className="font-medium">{geometry.selectionLabel ?? "Selected face boundary"}</div>
      <div className="mt-1 text-muted-foreground">
        Plane Z: {typeof geometry.planeZ === "number" ? geometry.planeZ.toFixed(3) : "—"}
      </div>
      <div className="text-muted-foreground">
        Vertices: {Array.isArray(geometry.vertices) ? geometry.vertices.length : 0}
      </div>
    </div>
  );
}

type SchemaFieldsProps = {
  rootSchema: JsonSchema;
  schema: JsonSchema;
  value: DraftValue | undefined;
  path: readonly string[];
  onChange: (path: readonly string[], value: DraftValue) => void;
  onStartGeometrySelection?: () => void;
};

function SchemaFields({ rootSchema, schema, value, path, onChange, onStartGeometrySelection }: SchemaFieldsProps) {
  const resolved = resolveSchema(schema, rootSchema);
  const metadata = getUiMetadata(schema, rootSchema);

  if (metadata.hidden) {
    return null;
  }

  const label = getSchemaTitle(schema, path[path.length - 1] ?? "Field", rootSchema);
  const unit = metadata.unit ? ` (${metadata.unit})` : "";

  if (metadata.readOnly) {
    if (resolved.type === "object" || resolved.properties) {
      return (
        <div className="space-y-1">
          <Label>{label}</Label>
          <GeometrySummary value={value} />
          {resolved.description ? (
            <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
          ) : null}
        </div>
      );
    }

    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">{formatReadOnlyValue(value)}</div>
        {resolved.description ? (
          <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
        ) : null}
      </div>
    );
  }

  if (resolved.properties) {
    return (
      <div className="space-y-4">
        {path.length === 1 && path[0] === "controlGeometry" && onStartGeometrySelection ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-sm font-medium">Control geometry</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Pick an XY-coplanar face from the viewport. The dialog will hide while you select it.
            </p>
            <Button type="button" variant="outline" className="mt-3" onClick={onStartGeometrySelection}>
              Select XY-coplanar face
            </Button>
          </div>
        ) : null}

        {Object.entries(resolved.properties).map(([key, childSchema]) => (
          <SchemaFields
            key={[...path, key].join(".")}
            rootSchema={rootSchema}
            schema={childSchema}
            value={
              value && typeof value === "object" && !Array.isArray(value)
                ? (value as DraftObject)[key]
                : undefined
            }
            path={[...path, key]}
            onChange={onChange}
            onStartGeometrySelection={onStartGeometrySelection}
          />
        ))}
      </div>
    );
  }

  if (resolved.enum || resolved.const !== undefined) {
    const options = resolved.enum ?? (resolved.const !== undefined ? [String(resolved.const)] : []);
    const currentValue = typeof value === "string" ? value : (resolved.default as string | undefined) ?? "";

    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <select
          value={currentValue}
          onChange={(event) => onChange(path, event.target.value)}
          className={SELECT_CLASSNAME}
          disabled={resolved.const !== undefined}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        {resolved.description ? (
          <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
        ) : null}
      </div>
    );
  }

  if (resolved.type === "boolean") {
    const checked = typeof value === "boolean" ? value : Boolean(resolved.default);
    return (
      <label className="flex items-center justify-between gap-3 rounded-md border p-3">
        <div>
          <div className="text-sm font-medium">{label}</div>
          {resolved.description ? (
            <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
          ) : null}
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(path, event.target.checked)}
          className="h-4 w-4"
        />
      </label>
    );
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    const currentValue = typeof value === "string" ? value : value == null ? "" : String(value);
    return (
      <div className="space-y-1">
        <Label>{`${label}${unit}`}</Label>
        <Input
          type="text"
          inputMode="decimal"
          value={currentValue}
          onChange={(event) => onChange(path, event.target.value)}
        />
        {resolved.description ? (
          <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
        ) : null}
      </div>
    );
  }

  const currentValue = typeof value === "string" ? value : value == null ? "" : String(value);
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input type="text" value={currentValue} onChange={(event) => onChange(path, event.target.value)} />
      {resolved.description ? (
        <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
      ) : null}
    </div>
  );
}

type OperationDialogProps = {
  open: boolean;
  draft: DraftObject | null;
  mode: "create" | "edit";
  rootSchema: JsonSchema;
  onDraftChange: (draft: DraftObject) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onStartGeometrySelection: () => void;
};

export function OperationDialog({
  open,
  draft,
  mode,
  rootSchema,
  onDraftChange,
  onOpenChange,
  onSave,
  onStartGeometrySelection,
}: OperationDialogProps) {
  const sections = useMemo(() => getVisibleSections(rootSchema), [rootSchema]);
  const [requestedSectionKey, setRequestedSectionKey] = useState(sections[0]?.key ?? "");
  const activeSection = sections.find((section) => section.key === requestedSectionKey) ?? sections[0];

  useEffect(() => {
    if (!open) {
      return;
    }

    setRequestedSectionKey((currentKey) => {
      const fallbackKey = sections[0]?.key ?? "";
      if (mode === "create" && sections.some((section) => section.key === "controlGeometry")) {
        return "controlGeometry";
      }
      return sections.some((section) => section.key === currentKey) ? currentKey : fallbackKey;
    });
  }, [mode, open, sections]);

  const validationMessage = useMemo(() => {
    if (!draft) {
      return "Select a face to start a pocket operation.";
    }

    try {
      parsePocketOperationDraft(draft);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Operation is invalid.";
    }
  }, [draft]);

  if (!draft) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid h-[85vh] max-h-[90vh] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add pocket operation" : "Edit pocket operation"}</DialogTitle>
          <DialogDescription>
            Fill out the operation form generated from the backend Pydantic schema.
          </DialogDescription>
        </DialogHeader>

        <SidebarProvider defaultOpen>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
            <Sidebar className="bg-muted/30" style={{ "--sidebar-width": "12rem" } as React.CSSProperties}>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupLabel>Operation sections</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {sections.map((section) => (
                        <SidebarMenuItem key={section.key}>
                          <SidebarMenuButton
                            type="button"
                            isActive={section.key === activeSection?.key}
                            onClick={() => setRequestedSectionKey(section.key)}
                          >
                            <span>{section.title}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              </SidebarContent>
            </Sidebar>

            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {activeSection ? (
                <div className="space-y-4">
                  <SchemaFields
                    rootSchema={rootSchema}
                    schema={activeSection.schema}
                    value={draft[activeSection.key]}
                    path={[activeSection.key]}
                    onChange={(nextPath, nextValue) => onDraftChange(setDraftValueAtPath(draft, nextPath, nextValue))}
                    onStartGeometrySelection={onStartGeometrySelection}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </SidebarProvider>

        <DialogFooter>
          {validationMessage ? (
            <p className="mr-auto text-xs leading-5 text-destructive">{validationMessage}</p>
          ) : null}
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={validationMessage !== null}>
            {mode === "create" ? "Add operation" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
