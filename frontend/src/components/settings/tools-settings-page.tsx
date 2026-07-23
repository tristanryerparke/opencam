import { useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "t-components/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "t-components/table";
import { ToolEditorDialog } from "@/components/tool-editor-dialog";
import {
  addTool,
  deleteTool,
  listTools,
  updateTool,
  type ToolLibraryTool,
  type ToolLibraryToolInput,
} from "@/lib/tool-library-api";

const toolQueryKey = ["tool-library", "tools"] as const;

function getToolDisplayName(tool: ToolLibraryTool) {
  return tool.name?.trim() || "Untitled Tool";
}

export function ToolsSettingsPage() {
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
