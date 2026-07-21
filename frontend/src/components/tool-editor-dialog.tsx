import { useEffect, useState, type FormEvent } from "react";

import { Button } from "t-components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "t-components/dialog";
import { GroupBox } from "@/components/ui/group-box";
import IntegerInput from "@/components/ui/integer-input";
import { Input } from "t-components/input";
import { Label } from "t-components/label";
import NumberInput from "@/components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "t-components/radio-group";
import type { ToolLibraryTool, ToolLibraryToolInput, ToolType } from "@/lib/tool-library-api";

type ToolFormState = {
  id: string;
  name: string;
  type: ToolType;
  diameter: number | undefined;
  cuttingHeight: number | undefined;
  shoulderHeight: number | undefined;
  numFlutes: number | undefined;
  toolNumber: number | undefined;
  manualChange: boolean;
};

function toolToFormState(tool?: ToolLibraryTool | null): ToolFormState {
  return {
    id: tool?.id ?? "",
    name: tool?.name ?? "",
    type: tool?.type === "ball" ? "ball" : "cylinder",
    diameter: tool?.diameter,
    cuttingHeight: tool?.cuttingHeight,
    shoulderHeight: tool?.shoulderHeight,
    numFlutes: tool?.numFlutes ?? 2,
    toolNumber: tool?.toolNumber ?? 1,
    manualChange: tool?.manualChange ?? false,
  };
}

function parsePositiveNumber(value: number | undefined, label: string) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return value;
}

function parseToolNumber(value: number | undefined) {
  if (!Number.isInteger(value) || value === undefined || value < 1) {
    throw new Error("Tool number must be a positive integer.");
  }
  return value;
}

function parseToolFormState(form: ToolFormState, mode: "add" | "edit"): ToolLibraryToolInput {
  const name = form.name.trim();
  if (!name) {
    throw new Error("Tool name is required.");
  }

  const common = {
    name,
    type: form.type,
    diameter: parsePositiveNumber(form.diameter, "Diameter"),
    cuttingHeight: parsePositiveNumber(form.cuttingHeight, "Cutting height"),
    shoulderHeight: parsePositiveNumber(form.shoulderHeight, "Shoulder height"),
    numFlutes: parsePositiveNumber(form.numFlutes, "Flute count"),
    toolNumber: parseToolNumber(form.toolNumber),
    manualChange: form.manualChange,
  };
  const parsed = { ...common, type: form.type as "cylinder" | "ball" };

  const id = form.id.trim();
  if (mode === "edit") {
    if (!id) {
      throw new Error("Unable to edit this tool.");
    }
    return { id, ...parsed } as ToolLibraryToolInput;
  }

  return id ? { id, ...parsed } as ToolLibraryToolInput : parsed as ToolLibraryToolInput;
}

export type ToolEditorDialogProps = {
  open: boolean;
  mode: "add" | "edit";
  tool: ToolLibraryTool | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (tool: ToolLibraryToolInput) => void;
};

export function ToolEditorDialog({
  open,
  mode,
  tool,
  isPending,
  onOpenChange,
  onSubmit,
}: ToolEditorDialogProps) {
  const [form, setForm] = useState<ToolFormState>(() => toolToFormState(tool));
  const [validationMessage, setValidationMessage] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(toolToFormState(tool));
      setValidationMessage(null);
    }
  }, [open, tool]);

  function updateField<Key extends keyof ToolFormState>(field: Key, value: ToolFormState[Key]) {
    setForm((current) => ({ ...current, [field]: value }));
    setValidationMessage(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      onSubmit(parseToolFormState(form, mode));
    } catch (error) {
      setValidationMessage(error instanceof Error ? error.message : "Tool settings are invalid.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "add" ? "Add tool" : "Edit tool"}</DialogTitle>
          <DialogDescription>Configure a tool-library record.</DialogDescription>
        </DialogHeader>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1">
            <Label htmlFor="tool-name">Tool name</Label>
            <Input
              id="tool-name"
              value={form.name}
              placeholder="e.g. 6mm flat end mill"
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <GroupBox title="Tool type">
            <RadioGroup
              value={form.type}
              onValueChange={(value) => updateField("type", value as ToolType)}
              className="flex gap-4"
            >
              {(["cylinder", "ball"] as const).map((type) => (
                <div key={type} className="flex items-center gap-2">
                  <RadioGroupItem id={`tool-type-${type}`} value={type} />
                  <Label htmlFor={`tool-type-${type}`} className="capitalize">{type}</Label>
                </div>
              ))}
            </RadioGroup>
          </GroupBox>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Diameter</Label>
              <NumberInput value={form.diameter} min={0} allowNegative={false} decimalScale={3} onValueChange={(value) => updateField("diameter", value)} />
            </div>
            <div className="space-y-1">
              <Label>Cutting height</Label>
              <NumberInput value={form.cuttingHeight} min={0} allowNegative={false} decimalScale={3} onValueChange={(value) => updateField("cuttingHeight", value)} />
            </div>
            <div className="space-y-1">
              <Label>Shoulder height</Label>
              <NumberInput value={form.shoulderHeight} min={0} allowNegative={false} decimalScale={3} onValueChange={(value) => updateField("shoulderHeight", value)} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Flutes</Label>
              <NumberInput value={form.numFlutes} min={0} allowNegative={false} decimalScale={0} onValueChange={(value) => updateField("numFlutes", value)} />
            </div>
            <div className="space-y-1">
              <Label>Tool number</Label>
              <IntegerInput value={form.toolNumber} min={1} step={1} allowNegative={false} onValueChange={(value) => updateField("toolNumber", value)} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.manualChange} onChange={(event) => updateField("manualChange", event.target.checked)} />
            Manual tool change
          </label>

          {validationMessage ? <p className="text-xs leading-5 text-destructive">{validationMessage}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={isPending}>{isPending ? "Saving..." : mode === "add" ? "Add tool" : "Save changes"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
