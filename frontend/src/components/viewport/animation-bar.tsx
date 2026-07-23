import { X } from "lucide-react";

import { Button } from "t-components/button";
import { Slider } from "@/components/ui/slider";
import { useCamStore } from "@/state/cam-store";
import { SIMULATION_STRIDE_OPTIONS } from "@/components/viewport/simulation-constants";

type AnimationBarProps = {
  disabled: boolean;
  onFrameChange: (values: number[]) => void;
  onPlay: () => void;
  onPause: () => void;
  onStrideChange: (values: number[]) => void;
  onExit: () => void;
};

function simulationStrideOptionIndex(stride: number) {
  const index = SIMULATION_STRIDE_OPTIONS.indexOf(stride as (typeof SIMULATION_STRIDE_OPTIONS)[number]);
  return index >= 0 ? index : 0;
}

export function AnimationBar({
  disabled,
  onFrameChange,
  onPlay,
  onPause,
  onStrideChange,
  onExit,
}: AnimationBarProps) {
  const isSimulationMode = useCamStore((state) => state.viewport.isSimulationMode);
  const simulationId = useCamStore((state) => state.simulation.id);
  const frameCount = useCamStore((state) => state.simulation.frameCount);
  const frameIndex = useCamStore((state) => state.simulation.frameIndex);
  const stride = useCamStore((state) => state.simulation.stride);
  const isPlaying = useCamStore((state) => state.simulation.isPlaying);

  if (!isSimulationMode || !simulationId || frameCount <= 0) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-2 z-20">
      <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-3 rounded-md border bg-background/95 px-2 py-2 shadow">
        <Button
          type="button"
          variant="outline"
          disabled={disabled || frameCount <= 1}
          onClick={isPlaying ? onPause : onPlay}
        >
          {isPlaying ? "Pause" : "Play"}
        </Button>

        <Slider
          min={0}
          max={Math.max(frameCount - 1, 0)}
          step={1}
          value={[frameIndex]}
          onValueChange={onFrameChange}
          disabled={disabled}
          className="flex-1"
        />

        <div className="w-20">
          <Slider
            min={0}
            max={SIMULATION_STRIDE_OPTIONS.length - 1}
            step={1}
            value={[simulationStrideOptionIndex(stride)]}
            onValueChange={onStrideChange}
          />
        </div>

        <div className="w-20 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground">
          Frame {frameIndex + 1} / {frameCount}
        </div>

        <Button type="button" variant="ghost" size="icon-xs" onClick={onExit} aria-label="Exit simulation" title="Exit simulation">
          <X />
        </Button>
      </div>
    </div>
  );
}
