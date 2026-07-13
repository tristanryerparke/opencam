import pocketingIconUrl from "../../../graphics/pocketing-1.svg";
import profilingIconUrl from "../../../graphics/profiling-1.svg";

import { Button } from "t-components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "t-components/dialog";

export function OperationTypeDialog({
  open,
  onOpenChange,
  onSelectPocketing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPocketing: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Add Operation</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Button
            type="button"
            variant="outline"
            className="h-auto flex-col gap-3 p-4"
            onClick={onSelectPocketing}
          >
            <img src={pocketingIconUrl} alt="" className="h-20 w-20 scale-150" />
            <span>2.5D Pocketing</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col gap-3 p-4">
            <img src={profilingIconUrl} alt="" className="h-20 w-20 scale-150" />
            <span>2.5D Profiling</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
