import type { ChangeEvent } from "react";
import { useStepViewerStore } from "@/store/use-step-viewer-store";

function formatCount(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

export function Sidebar() {
  const clearSelectedEdgeLoop = useStepViewerStore((state) => state.clearSelectedEdgeLoop);
  const clearSelectedFace = useStepViewerStore((state) => state.clearSelectedFace);
  const fileName = useStepViewerStore((state) => state.fileName);
  const hasResult = useStepViewerStore((state) => state.result !== null);
  const loadFile = useStepViewerStore((state) => state.loadFile);
  const loadState = useStepViewerStore((state) => state.loadState);
  const message = useStepViewerStore((state) => state.message);
  const pickMode = useStepViewerStore((state) => state.pickMode);
  const selectedEdgeLoop = useStepViewerStore((state) => state.selectedEdgeLoop);
  const selectedFace = useStepViewerStore((state) => state.selectedFace);
  const startEdgeLoopPicking = useStepViewerStore((state) => state.startEdgeLoopPicking);
  const startFacePicking = useStepViewerStore((state) => state.startFacePicking);
  const stats = useStepViewerStore((state) => state.stats);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) {
      void loadFile(file);
    }
  };

  return (
    <aside className="sidebar">
      <div>
        <p className="eyebrow">OpenCAM</p>
        <h1>STEP edge viewer</h1>
        <p className="description">
          Browser-only STEP import via OpenCascade WASM. Mesh faces use polygon offset;
          extracted BREP face boundaries render as normal 1px three.js line segments.
        </p>
      </div>

      <label className="upload-card">
        <span>Upload STEP</span>
        <input type="file" accept=".step,.stp" onChange={handleFileChange} />
      </label>

      <div className="selection-row">
        <button
          type="button"
          className={pickMode === "face" ? "primary-button active" : "primary-button"}
          disabled={!hasResult || selectedFace !== null}
          onClick={startFacePicking}
        >
          Select face
        </button>
        <button
          type="button"
          className="clear-button"
          disabled={selectedFace === null}
          aria-label="Clear selected face"
          onClick={clearSelectedFace}
        >
          ×
        </button>
      </div>

      <div className="selection-row">
        <button
          type="button"
          className={pickMode === "edge-loop" ? "primary-button active" : "primary-button"}
          disabled={!hasResult}
          onClick={startEdgeLoopPicking}
        >
          Select edge loop
        </button>
        <button
          type="button"
          className="clear-button"
          disabled={selectedEdgeLoop === null}
          aria-label="Clear selected edge loop"
          onClick={clearSelectedEdgeLoop}
        >
          ×
        </button>
      </div>

      <section className={`status status-${loadState}`}>
        <strong>{fileName ?? "No file selected"}</strong>
        <p>{message}</p>
      </section>

      {stats ? (
        <dl className="stats-grid">
          <div>
            <dt>STEP faces</dt>
            <dd>{formatCount(stats.brepFaces)}</dd>
          </div>
        </dl>
      ) : null}
    </aside>
  );
}
