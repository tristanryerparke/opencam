import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "t-components/button";
import { Checkbox } from "t-components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "t-components/dialog";
import IntegerInput from "@/components/ui/integer-input";
import { Input } from "t-components/input";
import { Label } from "t-components/label";
import { RadioGroup, RadioGroupItem } from "t-components/radio-group";
import NumberInput from "@/components/ui/number-input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "t-components/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "t-components/select";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "t-components/sidebar";
import {
  type DraftObject,
  type DraftValue,
  type JsonSchema,
  getDiscriminatedUnionOptions,
  getOperationLabel,
  getSchemaTitle,
  getUiMetadata,
  getVisibleSections,
  materializeDefaults,
  parseDraftValue,
  parseOperationDraft,
  resolveSchema,
  setDraftValueAtPath,
} from "@/lib/cam-schema";
import { listTools } from "@/lib/tool-library-api";

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
  const geometries = Array.isArray(value) ? value : [];

  return geometries.filter((geometry): geometry is DraftObject => {
    if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
      return false;
    }

    return Array.isArray(geometry.vertices) && geometry.vertices.length > 0;
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

const clearanceOptionLabels: Record<string, string> = {
  automatic: "Automatic",
  absolute: "Absolute",
  stock_max_z_plus_offset: "Stock max Z + offset",
  part_max_z_plus_offset: "Part max Z + offset",
};

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

function needsValues(rootSchema: JsonSchema, schema: JsonSchema, value: DraftValue | undefined, title: string) {
  try {
    parseDraftValue(schema, value, rootSchema, title);
    return false;
  } catch {
    return true;
  }
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
        Add XY-planar edge loop
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
                  <TableCell className="font-medium">Edge loop {index + 1}</TableCell>
                  <TableCell>{formatGeometryZ(geometry.z)}</TableCell>
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
                  No edge loops selected.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

type ToolSelectFieldProps = {
  label: string;
  description?: string;
  value: DraftValue | undefined;
  onChange: (value: DraftObject) => void;
};

function ToolSelectField({ label, description, value, onChange }: ToolSelectFieldProps) {
  const toolsQuery = useQuery({ queryKey: ["tool-library", "tools"], queryFn: listTools });
  const toolId = value && typeof value === "object" && !Array.isArray(value)
    ? String((value as DraftObject).id ?? "")
    : "";

  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select
        value={toolId}
        onValueChange={(toolId) => {
          const tool = (toolsQuery.data ?? []).find((candidate) => candidate.id === toolId);
          if (tool) onChange(tool as unknown as DraftObject);
        }}
        disabled={toolsQuery.isLoading}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={toolsQuery.isLoading ? "Loading tools..." : "Select a tool"} />
        </SelectTrigger>
        <SelectContent position="popper">
          {(toolsQuery.data ?? []).map((tool) => (
            <SelectItem key={tool.id} value={tool.id}>
              {tool.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {toolsQuery.isError ? (
        <p className="text-xs leading-5 text-destructive">Unable to load tools.</p>
      ) : null}
      {description ? <p className="text-xs leading-5 text-muted-foreground">{description}</p> : null}
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

  const label = getSchemaTitle(schema, path[path.length - 1] ?? "Field", rootSchema);
  const unit = metadata.unit ? ` (${metadata.unit})` : "";

  if (path.length === 1 && path[0] === "tool") {
    return (
      <ToolSelectField
        label={label}
        description={resolved.description}
        value={value}
        onChange={(tool) => onChange(path, tool)}
      />
    );
  }

  const discriminatedOptions = getDiscriminatedUnionOptions(resolved, rootSchema);
  if (resolved.discriminator && discriminatedOptions.length > 0) {
    const discriminatorName = resolved.discriminator.propertyName;
    const selectedValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as DraftObject)[discriminatorName]
        : undefined;
    const selectedOption = discriminatedOptions.find((option) => option.value === selectedValue) ?? discriminatedOptions[0];
    const optionSchema: JsonSchema = {
      ...selectedOption.schema,
      properties: Object.fromEntries(
        Object.entries(selectedOption.schema.properties ?? {}).filter(([key]) => key !== discriminatorName),
      ),
    };

    const selectOption = (nextValue: string) => {
      const nextOption = discriminatedOptions.find((option) => option.value === nextValue);
      if (nextOption) {
        onChange(path, materializeDefaults(nextOption.schema, rootSchema));
      }
    };
    const isClearanceMode = path.length === 1 && path[0] === "clearance";

    return (
      <div className="space-y-4">
        <div className="space-y-1">
          <Label>{label}</Label>
          {isClearanceMode ? (
            <RadioGroup value={selectedOption.value} onValueChange={selectOption} className="gap-2">
              {discriminatedOptions.map((option) => {
                const id = `clearance-mode-${option.value}`;
                const isSelected = option.value === selectedOption.value;
                const optionValue = value && typeof value === "object" && !Array.isArray(value)
                  ? (value as DraftObject)
                  : {};

                return (
                  <div key={option.value} className="flex items-center gap-2">
                    <RadioGroupItem id={id} value={option.value} />
                    <Label htmlFor={id}>
                      {clearanceOptionLabels[option.value] ?? option.value}
                    </Label>
                    {Object.entries(option.schema.properties ?? {}).map(([key, childSchema]) => {
                      const child = resolveSchema(childSchema, rootSchema);
                      if (child.type !== "number" && child.type !== "integer") {
                        return null;
                      }

                      const min = child.minimum ?? child.exclusiveMinimum;
                      return (
                        <NumberInput
                          key={key}
                          id={`${id}-${key}`}
                          value={getNumericValue(optionValue[key])}
                          min={min}
                          allowNegative={min === undefined || min < 0}
                          decimalScale={4}
                          disabled={!isSelected}
                          onValueChange={(nextValue) => onChange([...path, key], nextValue)}
                          className="ml-auto w-32"
                        />
                      );
                    })}
                  </div>
                );
              })}
            </RadioGroup>
          ) : (
            <Select value={selectedOption.value} onValueChange={selectOption}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select an option" />
              </SelectTrigger>
              <SelectContent position="popper">
                {discriminatedOptions.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {resolved.description ? (
            <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
          ) : null}
        </div>
        {!isClearanceMode ? (
          <SchemaFields
            rootSchema={rootSchema}
            schema={optionSchema}
            value={value}
            path={path}
            onChange={onChange}
            onStartGeometrySelection={onStartGeometrySelection}
          />
        ) : null}
      </div>
    );
  }

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

  if (path.length === 1 && path[0] === "driveGeometry" && resolved.type === "array" && onStartGeometrySelection) {
    return (
      <ControlGeometryPanel
        value={value}
        onStartGeometrySelection={onStartGeometrySelection}
        onDeleteGeometry={(index) => {
          const rows = getControlGeometryRows(value);
          onChange(path, rows.filter((_, rowIndex) => rowIndex !== index));
        }}
      />
    );
  }

  if (resolved.properties) {
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
    const id = `schema-field-${path.join("-")}`;
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={id}
          checked={checked}
          onCheckedChange={(nextChecked) => onChange(path, nextChecked === true)}
        />
        <div className="space-y-0.5">
          <Label htmlFor={id}>{label}</Label>
          {resolved.description ? (
            <p className="text-xs leading-5 text-muted-foreground">{resolved.description}</p>
          ) : null}
        </div>
      </div>
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
    if (mode === "create" && sections.some((section) => section.key === "driveGeometry")) {
      return "driveGeometry";
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
      return "Select an edge loop to start an operation.";
    }

    try {
      parseOperationDraft(draft);
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
          <DialogTitle>{getOperationLabel(draft)}</DialogTitle>
        </DialogHeader>

        <SidebarProvider defaultOpen>
          <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border">
            <Sidebar className="bg-muted/30" style={{ "--sidebar-width": "10rem" } as React.CSSProperties}>
              <SidebarContent>
                <SidebarGroup>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {sections.map((section) => {
                        const sectionNeedsValues = needsValues(rootSchema, section.schema, draft[section.key], section.title);
                        return (
                          <SidebarMenuItem key={section.key}>
                            <SidebarMenuButton
                              type="button"
                              className="justify-between"
                              isActive={section.key === activeSection?.key}
                              onClick={() => setRequestedSection({ sectionKey: section.key, sessionKey: draftSessionKey })}
                            >
                              <span>{section.title}</span>
                              {sectionNeedsValues ? (
                                <>
                                  <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-destructive" aria-hidden="true" />
                                  <span className="sr-only">Needs values</span>
                                </>
                              ) : null}
                            </SidebarMenuButton>
                          </SidebarMenuItem>
                        );
                      })}
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
