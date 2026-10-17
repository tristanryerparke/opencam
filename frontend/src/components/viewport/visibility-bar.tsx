import { Button } from "t-components/button";

import { useCamStore } from "@/state/cam-store";

export function VisibilityBar() {
  const showStock = useCamStore((state) => state.viewport.showStock);
  const showPartMesh = useCamStore((state) => state.viewport.showPartMesh);
  const showToolpaths = useCamStore((state) => state.viewport.showToolpaths);
  const showTool = useCamStore((state) => state.viewport.showTool);
  const isSimulationMode = useCamStore((state) => state.viewport.isSimulationMode);

  const setShowStock = useCamStore((state) => state.actions.setShowStock);
  const setShowPartMesh = useCamStore((state) => state.actions.setShowPartMesh);
  const setShowToolpaths = useCamStore((state) => state.actions.setShowToolpaths);
  const setShowTool = useCamStore((state) => state.actions.setShowTool);

  return (
    <div className="pointer-events-auto flex items-center gap-1 rounded-md border bg-background/90 p-1 shadow backdrop-blur">
      <Button
        type="button"
        className="w-12"
        variant={showStock ? "outline" : "secondary"}
        onClick={() => setShowStock((current) => !current)}
        aria-pressed={showStock}
      >
        Stock
      </Button>
      <Button
        type="button"
        className="w-12"
        variant={showPartMesh ? "outline" : "secondary"}
        onClick={() => setShowPartMesh((current) => !current)}
        aria-pressed={showPartMesh}
      >
        Part
      </Button>
      <Button
        type="button"
        className="w-18"
        variant={showToolpaths ? "outline" : "secondary"}
        onClick={() => setShowToolpaths((current) => !current)}
        aria-pressed={showToolpaths}
      >
        Toolpaths
      </Button>
      {isSimulationMode ? (
        <Button
          type="button"
          className="w-12"
          variant={showTool ? "outline" : "secondary"}
          onClick={() => setShowTool((current) => !current)}
          aria-pressed={showTool}
        >
          Tool
        </Button>
      ) : null}
    </div>
  );
}
