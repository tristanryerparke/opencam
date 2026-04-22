import { Eye, EyeOff, Pause, Play, ScanSearch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";
import { type SimulationSamplePoint } from "@/simulation/toolpath";

type SimulationTimelineProps = {
  className?: string;
  currentStep: number;
  totalSteps: number;
  isPlaying: boolean;
  sampleSpacing: number;
  showOriginalMesh: boolean;
  currentSample: SimulationSamplePoint | null;
  onPlayPause: () => void;
  onStepChange: (step: number) => void;
  onToggleShowOriginalMesh: () => void;
};

export function SimulationTimeline({
  className,
  currentStep,
  totalSteps,
  isPlaying,
  sampleSpacing,
  showOriginalMesh,
  currentSample,
  onPlayPause,
  onStepChange,
  onToggleShowOriginalMesh,
}: SimulationTimelineProps) {
  const sliderMax = Math.max(totalSteps, 1);
  const isDisabled = totalSteps === 0;
  const currentPathLabel = currentSample?.pathName ?? "Toolpath sample";
  const currentPathKindLabel = currentSample?.pathKind === "clearance" ? "Clearance" : "Cut";

  return (
    <div className={cn("pointer-events-none absolute inset-x-4 bottom-4 z-20", className)}>
      <div className="pointer-events-auto mx-auto flex max-w-4xl flex-col gap-3 rounded-2xl border bg-background/92 p-4 shadow-xl backdrop-blur">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ScanSearch className="size-4" />
              <span>Stock subtraction simulation</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Sampling tool motion every {sampleSpacing.toFixed(2)} mm and subtracting a
              cylinder that matches the tool diameter and cutting height.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="rounded-full border px-2 py-1">
              {currentStep.toLocaleString()} / {totalSteps.toLocaleString()} steps
            </span>
            {currentSample ? (
              <span className="rounded-full border px-2 py-1">
                {currentPathKindLabel}: {currentPathLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <Button
            type="button"
            variant={isPlaying ? "secondary" : "default"}
            className="min-w-24"
            onClick={onPlayPause}
            disabled={isDisabled}
          >
            {isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
            {isPlaying ? "Pause" : currentStep >= totalSteps ? "Replay" : "Play"}
          </Button>

          <div className="flex min-w-0 flex-1 items-center gap-3">
            <span className="w-10 text-right text-xs text-muted-foreground">0</span>
            <Slider
              min={0}
              max={sliderMax}
              step={1}
              value={[Math.min(currentStep, sliderMax)]}
              onValueChange={(value) => onStepChange(value[0] ?? 0)}
              disabled={isDisabled}
              aria-label="Simulation timeline"
            />
            <span className="w-16 text-xs text-muted-foreground">{totalSteps}</span>
          </div>

          <Button
            type="button"
            variant={showOriginalMesh ? "secondary" : "outline"}
            onClick={onToggleShowOriginalMesh}
          >
            {showOriginalMesh ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
            {showOriginalMesh ? "Hide STL" : "Show STL"}
          </Button>
        </div>
      </div>
    </div>
  );
}
