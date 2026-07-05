import { useEffect, useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { GroupBox } from "@/components/ui/group-box";
import IntegerInput from "@/components/ui/integer-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import NumberInput from "@/components/ui/number-input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ToolLibraryTool, ToolLibraryToolInput } from "@/lib/tool-library-api";

type ToolNumberMode = "number" | "manual";

type ToolFormState = {
  id: string;
  name: string;
  diameter: number | undefined;
  fluteLength: number | undefined;
  shoulderLength: number | undefined;
  toolNumberMode: ToolNumberMode;
  toolNumber: number | undefined;
};

function toolToFormState(tool?: ToolLibraryTool | null): ToolFormState {
  const numberedToolValue = typeof tool?.toolNumber === "number" ? tool.toolNumber : undefined;

  return {
    id: tool?.id ?? "",
    name: tool?.name ?? "",
    diameter: tool?.diameter,
    fluteLength: tool?.fluteLength,
    shoulderLength: tool?.shoulderLength,
    toolNumberMode: tool?.toolNumber === "manual" ? "manual" : "number",
    toolNumber: numberedToolValue ?? 1,
  };
}

function parsePositiveNumber(value: number | undefined, label: string) {
  if (!Number.isFinite(value) || value === undefined || value <= 0) {
    throw new Error(`${label} must be greater than 0.`);
  }
  return value;
}

function parseToolFormState(form: ToolFormState, mode: "add" | "edit"): ToolLibraryToolInput | ToolLibraryTool {
  let toolNumber: ToolLibraryTool["toolNumber"];

  if (form.toolNumberMode === "manual") {
    toolNumber = "manual";
  } else {
    const parsedToolNumber = form.toolNumber;
    if (!Number.isInteger(parsedToolNumber) || parsedToolNumber === undefined || parsedToolNumber < 1) {
      throw new Error("Tool number must be a positive integer.");
    }
    toolNumber = parsedToolNumber;
  }

  const name = form.name.trim();
  if (!name) {
    throw new Error("Tool name is required.");
  }

  const parsed = {
    name,
    diameter: parsePositiveNumber(form.diameter, "Diameter"),
    fluteLength: parsePositiveNumber(form.fluteLength, "Flute length"),
    shoulderLength: parsePositiveNumber(form.shoulderLength, "Shoulder length"),
    toolNumber,
  };

  const id = form.id.trim();
  if (mode === "edit") {
    if (!id) {
      throw new Error("Unable to edit this tool.");
    }
    return { id, ...parsed };
  }

  return id ? { id, ...parsed } : parsed;
}

export type ToolEditorDialogProps = {
  open: boolean;
  mode: "add" | "edit";
  tool: ToolLibraryTool | null;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (tool: ToolLibraryToolInput | ToolLibraryTool) => void;
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

  function updateToolNumberMode(toolNumberMode: ToolNumberMode) {
    setForm((current) => ({
      ...current,
      toolNumberMode,
      toolNumber: toolNumberMode === "number" && current.toolNumber === undefined ? 1 : current.toolNumber,
    }));
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
          <DialogDescription>
            Configure the tool dimensions used by backend tool-library records.
          </DialogDescription>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label>Diameter</Label>
              <NumberInput
                value={form.diameter}
                min={0}
                allowNegative={false}
                decimalScale={3}
                placeholder="e.g. 6.35"
                onValueChange={(value) => updateField("diameter", value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Flute length</Label>
              <NumberInput
                value={form.fluteLength}
                min={0}
                allowNegative={false}
                decimalScale={3}
                placeholder="Flute length"
                onValueChange={(value) => updateField("fluteLength", value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Shoulder length</Label>
              <NumberInput
                value={form.shoulderLength}
                min={0}
                allowNegative={false}
                decimalScale={3}
                placeholder="Shoulder length"
                onValueChange={(value) => updateField("shoulderLength", value)}
              />
            </div>
          </div>

          <GroupBox title="Tool change">
            <RadioGroup
              value={form.toolNumberMode}
              onValueChange={(value) => updateToolNumberMode(value as ToolNumberMode)}
              className="gap-1"
            >
              <div
                className="flex h-7 cursor-pointer items-center gap-2 px-0"
                onPointerDownCapture={() => updateToolNumberMode("number")}
              >
                <RadioGroupItem id="tool-number-mode-number" value="number" />
                <div className="flex flex-1 items-center justify-between gap-2">
                  <Label htmlFor="tool-number-mode-number" className="cursor-pointer">
                    Tool Number
                  </Label>
                  <IntegerInput
                    value={form.toolNumber}
                    min={1}
                    step={1}
                    allowNegative={false}
                    placeholder="1"
                    disabled={form.toolNumberMode === "manual"}
                    onValueChange={(value) => updateField("toolNumber", value)}
                    className={`max-w-24 flex-none ${form.toolNumberMode === "manual" ? "pointer-events-none" : ""}`}
                  />
                </div>
              </div>
              <div
                className="flex h-7 cursor-pointer items-center gap-2 px-0"
                onPointerDownCapture={() => updateToolNumberMode("manual")}
              >
                <RadioGroupItem id="tool-number-mode-manual" value="manual" />
                <Label htmlFor="tool-number-mode-manual" className="cursor-pointer">
                  Manual Tool Change
                </Label>
              </div>
            </RadioGroup>
          </GroupBox>

          {validationMessage ? (
            <p className="text-xs leading-5 text-destructive">{validationMessage}</p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : mode === "add" ? "Add tool" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
