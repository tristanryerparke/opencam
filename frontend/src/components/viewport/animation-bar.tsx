import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward, X } from "lucide-react";

import { Button } from "t-components/button";
import { ButtonGroup } from "t-components/button-group";
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

function PlaybackButtonGroup({
  disabled,
  frameCount,
  frameIndex,
  isPlaying,
  onFrameChange,
  onPlay,
  onPause,
}: {
  disabled: boolean;
  frameCount: number;
  frameIndex: number;
  isPlaying: boolean;
  onFrameChange: (values: number[]) => void;
  onPlay: () => void;
  onPause: () => void;
}) {
  const atStart = frameIndex <= 0;
  const atEnd = frameIndex >= frameCount - 1;

  const stepTo = (nextFrameIndex: number) => {
    onFrameChange([Math.max(0, Math.min(nextFrameIndex, frameCount - 1))]);
  };

  return (
    <ButtonGroup aria-label="Simulation playback controls">
      {[
        {
          key: "skip-to-start",
          label: "Skip to beginning",
          icon: <SkipBack />,
          onClick: () => stepTo(0),
          disabled: disabled || atStart,
        },
        {
          key: "step-back",
          label: "Skip back one frame",
          icon: <ChevronLeft />,
          onClick: () => stepTo(frameIndex - 1),
          disabled: disabled || atStart,
        },
        {
          key: "play-pause",
          label: isPlaying ? "Pause" : "Play",
          icon: isPlaying ? <Pause /> : <Play />,
          onClick: isPlaying ? onPause : onPlay,
          disabled: disabled || frameCount <= 1,
        },
        {
          key: "step-forward",
          label: "Skip forward one frame",
          icon: <ChevronRight />,
          onClick: () => stepTo(frameIndex + 1),
          disabled: disabled || atEnd,
        },
        {
          key: "skip-to-end",
          label: "Skip to end",
          icon: <SkipForward />,
          onClick: () => stepTo(frameCount - 1),
          disabled: disabled || atEnd,
        },
      ].map(({ key, label, icon, onClick, disabled: buttonDisabled }) => (
        <Button
          key={key}
          type="button"
          variant="outline"
          size="icon-xs"
          onClick={onClick}
          disabled={buttonDisabled}
          aria-label={label}
          title={label}
        >
          {icon}
        </Button>
      ))}
    </ButtonGroup>
  );
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
        <PlaybackButtonGroup
          disabled={disabled}
          frameCount={frameCount}
          frameIndex={frameIndex}
          isPlaying={isPlaying}
          onFrameChange={onFrameChange}
          onPlay={onPlay}
          onPause={onPause}
        />

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

        <div
          className="w-16 shrink-0 whitespace-nowrap text-right text-xs tabular-nums text-muted-foreground"
          aria-label="Simulation frame progress"
          title={`${frameIndex + 1} of ${frameCount} frames`}
        >
          {frameIndex + 1} / {frameCount}
        </div>

        <Button type="button" variant="ghost" size="icon-xs" onClick={onExit} aria-label="Exit simulation" title="Exit simulation">
          <X />
        </Button>
      </div>
    </div>
  );
}
