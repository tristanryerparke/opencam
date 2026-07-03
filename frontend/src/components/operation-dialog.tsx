import { useMemo, useState } from "react";

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
            <div className="text-sm font-medium">Select control geometry</div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Pick a flat XY-coplanar area from the viewport. The dialog will hide while you select it.
            </p>
            <Button type="button" variant="outline" className="mt-3" onClick={onStartGeometrySelection}>
              Select flat area
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
  const [requestedTab, setRequestedTab] = useState(sections[0]?.key ?? "");
  const activeTab = sections.some((section) => section.key === requestedTab)
    ? requestedTab
    : (sections[0]?.key ?? "");

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
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add pocket operation" : "Edit pocket operation"}</DialogTitle>
          <DialogDescription>
            Fill out the operation form generated from the backend Pydantic schema.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setRequestedTab} orientation="vertical" className="min-h-0 flex-1 overflow-hidden">
          <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] gap-6 overflow-hidden">
            <TabsList variant="line" className="h-full w-full flex-col items-stretch justify-start rounded-md border bg-muted/30 p-2">
              {sections.map((section) => (
                <TabsTrigger key={section.key} value={section.key} className="justify-start px-3 py-2 text-left">
                  {section.title}
                </TabsTrigger>
              ))}
            </TabsList>

            <div className="min-h-0 overflow-y-auto pr-1">
              {sections.map((section) => (
                <TabsContent key={section.key} value={section.key} className="space-y-4">
                  <SchemaFields
                    rootSchema={rootSchema}
                    schema={section.schema}
                    value={draft[section.key]}
                    path={[section.key]}
                    onChange={(nextPath, nextValue) => onDraftChange(setDraftValueAtPath(draft, nextPath, nextValue))}
                    onStartGeometrySelection={onStartGeometrySelection}
                  />
                </TabsContent>
              ))}
            </div>
          </div>
        </Tabs>

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
