import { useMemo, useState } from "react";
import { Monitor, Moon, Pencil, Plus, Settings, Sun, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "t-components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "t-components/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "t-components/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "t-components/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "t-components/tabs";
import { useTheme, type Theme } from "@/components/mode-toggle";
import { ToolEditorDialog } from "@/components/tool-editor-dialog";
import type { ToolRenderMode } from "@/components/polyline-viewer/types";
import {
  addTool,
  deleteTool,
  listTools,
  updateTool,
  type ToolLibraryTool,
  type ToolLibraryToolInput,
} from "@/lib/tool-library-api";

const toolQueryKey = ["tool-library", "tools"] as const;
const themeModes = ["system", "light", "dark"] as const;

type SettingsDialogProps = {
  simulationDebugUiEnabled: boolean;
  onSimulationDebugUiEnabledChange: (enabled: boolean) => void;
  toolRenderMode: ToolRenderMode;
  onToolRenderModeChange: (mode: ToolRenderMode) => void;
  partRenderMode: ToolRenderMode;
  onPartRenderModeChange: (mode: ToolRenderMode) => void;
  stockRenderMode: ToolRenderMode;
  onStockRenderModeChange: (mode: ToolRenderMode) => void;
  clearanceOffset: number;
  onClearanceOffsetChange: (offset: number) => void;
};

const themeModeConfig = {
  system: { icon: Monitor, label: "System" },
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
} satisfies Record<Theme, { icon: typeof Monitor; label: string }>;

function getToolDisplayName(tool: ToolLibraryTool) {
  return tool.name?.trim() || "Untitled Tool";
}

function ThemeSelect() {
  const { theme, setTheme } = useTheme();

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
      <SelectTrigger className="w-36">
        <SelectValue placeholder="Select theme" />
      </SelectTrigger>
      <SelectContent>
        {themeModes.map((mode) => {
          const Icon = themeModeConfig[mode].icon;
          return (
            <SelectItem key={mode} value={mode}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{themeModeConfig[mode].label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function ToolsSettingsTab() {
  const queryClient = useQueryClient();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolLibraryTool | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const toolsQuery = useQuery({
    queryKey: toolQueryKey,
    queryFn: listTools,
  });

  const refreshTools = () => {
    void queryClient.invalidateQueries({ queryKey: toolQueryKey });
  };

  const addToolMutation = useMutation({
    mutationFn: addTool,
    onSuccess: () => {
      refreshTools();
      setEditorOpen(false);
    },
    onError: (error) => setMutationError(error instanceof Error ? error.message : "Failed to add tool."),
  });

  const updateToolMutation = useMutation({
    mutationFn: updateTool,
    onSuccess: () => {
      refreshTools();
      setEditorOpen(false);
      setEditingTool(null);
    },
    onError: (error) => setMutationError(error instanceof Error ? error.message : "Failed to update tool."),
  });

  const deleteToolMutation = useMutation({
    mutationFn: deleteTool,
    onSuccess: refreshTools,
    onError: (error) => setMutationError(error instanceof Error ? error.message : "Failed to delete tool."),
  });

  const tools = useMemo(() => toolsQuery.data ?? [], [toolsQuery.data]);
  const isSaving = addToolMutation.isPending || updateToolMutation.isPending;

  function handleAddTool() {
    setMutationError(null);
    setEditingTool(null);
    setEditorOpen(true);
  }

  function handleEditTool(tool: ToolLibraryTool) {
    setMutationError(null);
    setEditingTool(tool);
    setEditorOpen(true);
  }

  function handleEditorSubmit(tool: ToolLibraryToolInput) {
    setMutationError(null);
    if (editingTool) {
      if (!tool.id) {
        setMutationError("Unable to edit this tool.");
        return;
      }
      updateToolMutation.mutate({ ...tool, id: tool.id });
      return;
    }
    addToolMutation.mutate(tool);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium">Tool library</h3>
          <p className="text-xs text-muted-foreground">Tools are stored in the backend TinyDB library.</p>
        </div>
        <Button type="button" onClick={handleAddTool}>
          <Plus className="size-4" />
          Add tool
        </Button>
      </div>

      {toolsQuery.isError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {toolsQuery.error instanceof Error ? toolsQuery.error.message : "Failed to load tools."}
        </div>
      ) : null}

      {mutationError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
          {mutationError}
        </div>
      ) : null}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Diameter</TableHead>
              <TableHead>Cutting height</TableHead>
              <TableHead>Shoulder height</TableHead>
              <TableHead>Tool #</TableHead>
              <TableHead>Manual</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {toolsQuery.isLoading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  Loading tools...
                </TableCell>
              </TableRow>
            ) : tools.length > 0 ? (
              tools.map((tool) => (
                <TableRow key={tool.id}>
                  <TableCell className="max-w-48 truncate font-medium">{getToolDisplayName(tool)}</TableCell>
                  <TableCell className="capitalize">{tool.type}</TableCell>
                  <TableCell>{tool.diameter}</TableCell>
                  <TableCell>{tool.cuttingHeight}</TableCell>
                  <TableCell>{tool.shoulderHeight}</TableCell>
                  <TableCell>{tool.toolNumber}</TableCell>
                  <TableCell>{tool.manualChange ? "Yes" : "No"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="outline"
                        aria-label={`Edit ${getToolDisplayName(tool)}`}
                        onClick={() => handleEditTool(tool)}
                      >
                        <Pencil className="size-3.5" />
                      </Button>
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="destructive"
                        aria-label={`Delete ${getToolDisplayName(tool)}`}
                        disabled={deleteToolMutation.isPending}
                        onClick={() => deleteToolMutation.mutate(tool.id)}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={8} className="text-muted-foreground">
                  No tools have been added yet.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <ToolEditorDialog
        open={editorOpen}
        mode={editingTool ? "edit" : "add"}
        tool={editingTool}
        isPending={isSaving}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) {
            setEditingTool(null);
          }
        }}
        onSubmit={handleEditorSubmit}
      />
    </div>
  );
}

function RenderModeTabs({
  value,
  onChange,
  ariaLabel,
}: {
  value: ToolRenderMode;
  onChange: (mode: ToolRenderMode) => void;
  ariaLabel: string;
}) {
  return (
    <Tabs aria-label={ariaLabel} value={value} onValueChange={(next) => onChange(next as ToolRenderMode)}>
      <TabsList>
        <TabsTrigger value="wireframe">Wireframe</TabsTrigger>
        <TabsTrigger value="shaded">Shaded</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

function GeneralSettingsTab({
  simulationDebugUiEnabled,
  onSimulationDebugUiEnabledChange,
  toolRenderMode,
  onToolRenderModeChange,
  partRenderMode,
  onPartRenderModeChange,
  stockRenderMode,
  onStockRenderModeChange,
  clearanceOffset,
  onClearanceOffsetChange,
}: SettingsDialogProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Theme</div>
          <p className="text-xs text-muted-foreground">Choose light, dark, or follow the system preference.</p>
        </div>
        <ThemeSelect />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Tool render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded tool previews.</p>
        </div>
        <RenderModeTabs value={toolRenderMode} onChange={onToolRenderModeChange} ariaLabel="Tool render mode" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Part render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded part meshes.</p>
        </div>
        <RenderModeTabs value={partRenderMode} onChange={onPartRenderModeChange} ariaLabel="Part render mode" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Stock render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded stock meshes.</p>
        </div>
        <RenderModeTabs value={stockRenderMode} onChange={onStockRenderModeChange} ariaLabel="Stock render mode" />
      </div>

      <label className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Automatic clearance offset</div>
          <p className="text-xs text-muted-foreground">Added above the highest part, stock, or operation Z.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.1"
            value={clearanceOffset}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0) {
                onClearanceOffsetChange(next);
              }
            }}
            className="w-24 rounded-md border bg-background px-2 py-1 text-right text-sm"
            aria-label="Automatic clearance offset in millimeters"
          />
          <span className="text-sm text-muted-foreground">mm</span>
        </div>
      </label>

      <label className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Simulation debug UI</div>
          <p className="text-xs text-muted-foreground">Show chunk stats and debug colors in the viewport.</p>
        </div>
        <input
          type="checkbox"
          checked={simulationDebugUiEnabled}
          onChange={(event) => onSimulationDebugUiEnabledChange(event.target.checked)}
        />
      </label>

    </div>
  );
}

export function SettingsDialog(props: SettingsDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="icon-xs" variant="outline" aria-label="Open settings">
          <Settings className="size-4" />
          <span className="sr-only">Open settings</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="grid h-[75vh] max-h-[90vh] w-[calc(100%-2rem)] max-w-4xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Manage OpenCAM preferences and backend library records.</DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="tools" className="min-h-0 overflow-hidden">
          <TabsList className="w-fit">
            <TabsTrigger value="tools">Tools</TabsTrigger>
            <TabsTrigger value="settings">Settings</TabsTrigger>
          </TabsList>
          <TabsContent value="tools" className="min-h-0 overflow-y-auto pr-1">
            <ToolsSettingsTab />
          </TabsContent>
          <TabsContent value="settings" className="min-h-0 overflow-y-auto pr-1">
            <GeneralSettingsTab {...props} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
