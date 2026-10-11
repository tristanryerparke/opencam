type SimulationDebugOverlayProps = {
  visible: boolean;
  simulationId: string | null;
  clRecordIndex: number | null;
  chunkIndex: number | null;
  chunkCount: number;
  stepIndex: number | null;
  stepCount: number;
  focusMeshRequestMs: number | null;
  chunkFetchMs: number | null;
};

export function SimulationDebugOverlay({
  visible,
  simulationId,
  clRecordIndex,
  chunkIndex,
  chunkCount,
  stepIndex,
  stepCount,
  focusMeshRequestMs,
  chunkFetchMs,
}: SimulationDebugOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div className="pointer-events-auto absolute left-2 top-14 z-20 max-w-xs rounded-md border bg-background/90 p-2 text-xs shadow backdrop-blur">
      <div className="mb-1 font-medium">Simulation debug</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 tabular-nums">
        <span className="text-muted-foreground">Simulation ID</span>
        <span className="font-mono select-all">{simulationId?.split("-")[0] ?? "—"}</span>
        <span className="text-muted-foreground">CL record</span>
        <span className="font-mono select-all">{clRecordIndex ?? "—"}</span>
        <span className="text-muted-foreground">Chunk</span>
        <span>{chunkIndex == null ? "—" : `${chunkIndex + 1} / ${chunkCount || "?"}`}</span>
        <span className="text-muted-foreground">Step</span>
        <span>{stepIndex == null ? "—" : `${stepIndex + 1} / ${stepCount || "?"}`}</span>
        <span className="text-muted-foreground">Focus request</span>
        <span>{focusMeshRequestMs == null ? "—" : `${focusMeshRequestMs.toFixed(0)} ms`}</span>
        <span className="text-muted-foreground">Chunk fetch</span>
        <span>{chunkFetchMs == null ? "—" : `${chunkFetchMs.toFixed(0)} ms`}</span>
      </div>
    </div>
  );
}
