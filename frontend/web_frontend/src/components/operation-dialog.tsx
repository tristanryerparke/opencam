import { OperationDialog as SharedOperationDialog } from "opencam-react-ui/operation-dialog";

import type { DraftObject, JsonSchema } from "@/lib/cam-schema";
import { listTools } from "@/lib/tool-library-api";

export type OperationDialogProps = {
  open: boolean;
  draft: DraftObject | null;
  mode: "create" | "edit";
  rootSchema: JsonSchema;
  onDraftChange: (draft: DraftObject) => void;
  onOpenChange: (open: boolean) => void;
  onSave: () => void;
  onStartGeometrySelection: () => void;
};

export function OperationDialog(props: OperationDialogProps) {
  return <SharedOperationDialog
    {...props}
    loadTools={async () => (await listTools()).map((tool) => ({
      id: tool.id,
      name: tool.name,
      value: tool as unknown as DraftObject,
    }))}
  />;
}
