import pocketingIconUrl from "../../../../graphics/pocketing-1.svg";
import profilingIconUrl from "../../../../graphics/profiling-1.svg";
import facingIconUrl from "../../../../graphics/facing-1.svg";
import parallelFinishingIconUrl from "../../../../graphics/parallel_finishing.svg";

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
  onSelectProfiling,
  onSelectFacing,
  onSelectParallelFinishing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPocketing: () => void;
  onSelectProfiling: () => void;
  onSelectFacing: () => void;
  onSelectParallelFinishing: () => void;
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
            className="h-auto flex-col justify-between gap-3 p-4"
            onClick={onSelectPocketing}
          >
            <div className="flex h-[100px] w-[100px] items-end justify-center">
              <img src={pocketingIconUrl} alt="" className="h-20 w-20 origin-bottom translate-y-3 scale-[1.375]" />
            </div>
            <span className="text-center">2.5D Pocketing</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col justify-between gap-3 p-4" onClick={onSelectProfiling}>
            <div className="flex h-[100px] w-[100px] items-end justify-center">
              <img src={profilingIconUrl} alt="" className="h-20 w-20 origin-bottom translate-y-3 scale-[1.375]" />
            </div>
            <span className="text-center">2.5D Profiling</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col justify-between gap-3 p-4" onClick={onSelectFacing}>
            <div className="flex h-[100px] w-[100px] items-end justify-center">
              <img src={facingIconUrl} alt="" className="h-20 w-20 origin-bottom translate-y-3 scale-[1.375]" />
            </div>
            <span className="text-center">2.5D Facing</span>
          </Button>
          <Button type="button" variant="outline" className="h-auto flex-col justify-between gap-3 p-4" onClick={onSelectParallelFinishing}>
            <div className="flex h-[100px] w-[100px] items-end justify-center">
              <img src={parallelFinishingIconUrl} alt="" className="h-20 w-20 origin-bottom translate-y-3 scale-[1.375]" />
            </div>
            <span className="text-center">3D Parallel Finishing</span>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
