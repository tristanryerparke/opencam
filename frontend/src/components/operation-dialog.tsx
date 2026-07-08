import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import IntegerInput from "@/components/ui/integer-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NumberInput from "@/components/ui/number-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
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

function formatReadOnlyValue(value: DraftValue | undefined) {
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return "—";
}

function getControlGeometryRows(value: DraftValue | undefined): DraftObject[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  const driveGeometry = (value as DraftObject).driveGeometry;
  const geometries = Array.isArray(driveGeometry) ? driveGeometry : driveGeometry ? [driveGeometry] : [];

  return geometries.filter((geometry): geometry is DraftObject => {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
      return false;
    }

    const hasPlaneZ = typeof geometry.planeZ === "number" || typeof geometry.planeZ === "string";
    const hasVertices = Array.isArray(geometry.vertices) && geometry.vertices.length > 0;
    return hasPlaneZ && hasVertices;
  });
}

function formatGeometryZ(value: DraftValue | undefined) {
  if (typeof value === "number") {
    return value.toFixed(3);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed.toFixed(3) : value;
  }

  return "—";
}

function getNumericValue(value: DraftValue | undefined): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

type ControlGeometryPanelProps = {
  value: DraftValue | undefined;
  onStartGeometrySelection: () => void;
  onDeleteGeometry: (index: number) => void;
};

function ControlGeometryPanel({
  value,
  onStartGeometrySelection,
  onDeleteGeometry,
}: ControlGeometryPanelProps) {
  const rows = getControlGeometryRows(value);

  return (
    <div className="space-y-3">
      <Button type="button" onClick={onStartGeometrySelection}>
        Add XY-coplanar face
      </Button>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Geometry</TableHead>
              <TableHead>Z coordinate</TableHead>
              <TableHead className="w-24 text-right">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length > 0 ? (
              rows.map((geometry, index) => (
                <TableRow key={index}>
                  <TableCell className="font-medium">Coplanar Face {index + 1}</TableCell>
                  <TableCell>{formatGeometryZ(geometry.planeZ)}</TableCell>
                  <TableCell className="text-right">
                    <Button type="button" variant="destructive" onClick={() => onDeleteGeometry(index)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={3} className="text-muted-foreground">
                  No coplanar faces selected.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type SchemaFieldsProps = {
  rootSchema: JsonSchema;
  schema: JsonSchema;
  value: DraftValue | undefined;
  path: readonly string[];
  onChange: (path: readonly string[], value: DraftValue | undefined) => void;
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
    return (
      <div className="space-y-1">
        <Label>{label}</Label>
        <div className="rounded-md border bg-muted/40 px-2 py-2 text-sm">{formatReadOnlyValue(value)}</div>
        {resolved.description ? (
          <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
        ) : null}
      </div>
    );
  }

  if (resolved.properties) {
    if (path.length === 1 && path[0] === "controlGeometry" && onStartGeometrySelection) {
      return (
        <ControlGeometryPanel
          value={value}
          onStartGeometrySelection={onStartGeometrySelection}
          onDeleteGeometry={(index) => {
            const rows = getControlGeometryRows(value);
            onChange([...path, "driveGeometry"], rows.filter((_, rowIndex) => rowIndex !== index));
          }}
        />
      );
    }

    return (
      <div className="space-y-4">
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
        <Select
          value={currentValue}
          onValueChange={(nextValue) => onChange(path, nextValue)}
          disabled={resolved.const !== undefined}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select an option" />
          </SelectTrigger>
          <SelectContent position="popper">
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {resolved.description ? (
          <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
        ) : null}
      </div>
    );
  }

  if (resolved.type === "boolean") {
    const checked = typeof value === "boolean" ? value : Boolean(resolved.default);
    return (
      <label className="flex items-center justify-between gap-3 rounded-md border p-2">
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
    const numericValue = getNumericValue(value);
    const min = resolved.minimum ?? resolved.exclusiveMinimum;
    const allowNegative = min === undefined || min < 0;

    return (
      <div className="space-y-1">
        <Label>{`${label}${unit}`}</Label>
        {resolved.type === "integer" ? (
          <IntegerInput
            value={numericValue}
            min={min}
            allowNegative={allowNegative}
            onValueChange={(nextValue) => onChange(path, nextValue)}
          />
        ) : (
          <NumberInput
            value={numericValue}
            min={min}
            allowNegative={allowNegative}
            decimalScale={4}
            onValueChange={(nextValue) => onChange(path, nextValue)}
          />
        )}
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
  const defaultSectionKey = useMemo(() => {
    if (mode === "create" && sections.some((section) => section.key === "controlGeometry")) {
      return "controlGeometry";
    }

    return sections[0]?.key ?? "";
  }, [mode, sections]);
  const draftSessionKey = `${mode}:${typeof draft?.id === "string" ? draft.id : ""}`;
  const [requestedSection, setRequestedSection] = useState<{
    sectionKey: string;
    sessionKey: string;
  } | null>(null);
  const requestedSectionKey =
    requestedSection?.sessionKey === draftSessionKey ? requestedSection.sectionKey : defaultSectionKey;
  const activeSection = sections.find((section) => section.key === requestedSectionKey) ?? sections[0];

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
      <DialogContent
        showCloseButton={mode !== "create"}
        className="grid h-[85vh] max-h-[90vh] w-[calc(100%-2rem)] max-w-5xl grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden sm:max-w-5xl"
      >
        <DialogHeader>
          <DialogTitle>2.5D Pocketing</DialogTitle>
        </DialogHeader>

        <SidebarProvider defaultOpen>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
            <Sidebar className="bg-muted/30" style={{ "--sidebar-width": "10rem" } as React.CSSProperties}>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {sections.map((section) => (
                        <SidebarMenuItem key={section.key}>
                          <SidebarMenuButton
                            type="button"
                            isActive={section.key === activeSection?.key}
                            onClick={() => setRequestedSection({ sectionKey: section.key, sessionKey: draftSessionKey })}
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

            <div className="min-h-0 flex-1 overflow-y-auto p-2">
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
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={onSave} disabled={validationMessage !== null}>
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
