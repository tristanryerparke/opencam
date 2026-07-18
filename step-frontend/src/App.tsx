import { useCallback, useState } from "react";
import type { OcctReadResult } from "occt-import-js";
import { StepViewer } from "@/components/StepViewer";
import { readStepFile } from "@/lib/occt";
import type { SelectedBrepFace, StepSceneStats } from "@/lib/step-three";
import "./App.css";

type LoadState = "idle" | "loading" | "ready" | "error";

const READ_PARAMS = {
  linearUnit: "millimeter" as const,
  linearDeflectionType: "bounding_box_ratio" as const,
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

function formatCount(value: number) {
  return new Intl.NumberFormat().format(Math.round(value));
}

export default function App() {
  const [result, setResult] = useState<OcctReadResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("Upload a .step or .stp file to view it.");
  const [stats, setStats] = useState<StepSceneStats | null>(null);
  const [pickingMode, setPickingMode] = useState(false);
  const [selectedFace, setSelectedFace] = useState<SelectedBrepFace | null>(null);

  const loadFile = useCallback(async (file: File) => {
    setLoadState("loading");
    setMessage("Loading OpenCascade and reading STEP file…");
    setStats(null);
    setPickingMode(false);
    setSelectedFace(null);

    try {
      const nextResult = await readStepFile(file, READ_PARAMS);
      setFileName(file.name);
      setResult(nextResult);
      setLoadState("ready");
      setMessage("Loaded STEP faces and rendered BREP face-boundary edges as 1px LineSegments.");
    } catch (error) {
      setResult(null);
      setFileName(file.name);
      setLoadState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) {
      return;
    }

    void loadFile(file);
  }, [loadFile]);

  const handleFacePick = useCallback((selection: SelectedBrepFace) => {
    setSelectedFace(selection);
    setPickingMode(false);
    setMessage(`Selected BREP face ${selection.faceIndex + 1} on mesh ${selection.meshIndex + 1}.`);
  }, []);

  const clearSelectedFace = useCallback(() => {
    setSelectedFace(null);
    setPickingMode(false);
    setMessage("Selection cleared. Click Select face to pick another BREP face.");
  }, []);

  return (
    <main className="app-shell">
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
            className={pickingMode ? "primary-button active" : "primary-button"}
            disabled={!result || selectedFace !== null}
            onClick={() => setPickingMode(true)}
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

        <section className={`status status-${loadState}`}>
          <strong>{fileName ?? "No file selected"}</strong>
          <p>{message}</p>
        </section>

        {stats ? (
          <dl className="stats-grid">
            <div>
              <dt>Meshes</dt>
              <dd>{formatCount(stats.meshes)}</dd>
            </div>
            <div>
              <dt>BREP faces</dt>
              <dd>{formatCount(stats.brepFaces)}</dd>
            </div>
            <div>
              <dt>Triangles</dt>
              <dd>{formatCount(stats.triangles)}</dd>
            </div>
            <div>
              <dt>Edge segments</dt>
              <dd>{formatCount(stats.edgeSegments)}</dd>
            </div>
          </dl>
        ) : null}
      </aside>

      <section className="viewer-panel">
        <StepViewer
          result={result}
          pickingMode={pickingMode}
          selectedFace={selectedFace}
          onFacePick={handleFacePick}
          onStatsChange={setStats}
        />
      </section>
    </main>
  );
}
