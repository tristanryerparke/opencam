import "./styles.css";

type BridgeReply<T = unknown> = {
  id?: string;
  type: string;
  ok: boolean;
  data?: T;
  error?: string;
};

type PendingRequest = {
  resolve: (value: BridgeReply) => void;
  reject: (reason: Error) => void;
};

type LogEntry = {
  time: string;
  kind: "info" | "reply" | "error";
  message: string;
  data?: unknown;
};

declare global {
  interface Window {
    __openCamBridge?: {
      receive: (reply: BridgeReply) => void;
    };
  }
}

const pending = new Map<string, PendingRequest>();
const logs: LogEntry[] = [];
const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Missing app root");
}

const state = {
  backendUrl: "http://localhost:8000",
  hasStock: false,
  hasBoundary: false,
  hasOperation: false,
  taskId: "",
  stockSummary: "No stock selected.",
  boundarySummary: "No pocket area selected.",
  operationSummary: "Toolpath not generated.",
  simulationSummary: "No simulation started.",
};

window.__openCamBridge = {
  receive(reply) {
    addLog(reply.ok ? "reply" : "error", `${reply.type}: ${reply.ok ? "ok" : reply.error ?? "failed"}`);

    if (reply.type === "selectStock" && reply.ok) {
      state.hasStock = true;
      state.hasBoundary = false;
      state.hasOperation = false;
      state.taskId = "";
      state.stockSummary = buildStockSummary(reply.data);
      state.boundarySummary = "No pocket area selected.";
      state.operationSummary = "Toolpath not generated.";
      state.simulationSummary = "No simulation started.";
    }

    if (reply.type === "selectPocketBoundary" && reply.ok) {
      state.hasBoundary = true;
      state.hasOperation = false;
      state.taskId = "";
      state.boundarySummary = buildBoundarySummary(reply.data);
      state.operationSummary = "Toolpath not generated.";
      state.simulationSummary = "No simulation started.";
    }

    if (reply.type === "generateToolpath" && reply.ok) {
      state.hasOperation = true;
      state.taskId = "";
      state.operationSummary = buildToolpathSummary(reply.data);
      state.simulationSummary = "No simulation started.";
    }

    if (reply.type === "startSimulation" && reply.ok) {
      const taskId = readString(reply.data, "taskId");
      if (taskId) state.taskId = taskId;
      state.simulationSummary = taskId
        ? `Simulation queued. Task ${taskId.slice(0, 8)}…`
        : "Simulation queued.";
    }

    if (reply.type === "pollSimulation" && reply.ok) {
      const statusRoot = readObject(reply.data, "status") ?? reply.data;
      state.simulationSummary = buildSimulationSummary(statusRoot);
    }

    if (reply.type === "clearPreview" && reply.ok) {
      state.simulationSummary = state.taskId ? state.simulationSummary : "Viewport preview cleared.";
    }

    if (reply.id) {
      const request = pending.get(reply.id);
      if (request) {
        pending.delete(reply.id);
        if (reply.ok) request.resolve(reply);
        else request.reject(new Error(reply.error ?? "Rhino bridge request failed"));
      }
    }

    render();
  },
};

function sendToRhino(type: string, payload: Record<string, unknown> = {}) {
  const id = crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const message = {
    id,
    type,
    payload: {
      backendUrl: state.backendUrl,
      ...payload,
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(message));
  window.location.href = `rhino://message?${encoded}`;

  return new Promise<BridgeReply>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`${type} timed out`));
    }, 10 * 60 * 1000);
  });
}

function readString(value: unknown, key: string) {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : "";
}

function readNumber(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "number" ? candidate : null;
}

function readObject(value: unknown, key: string) {
  if (!value || typeof value !== "object") return null;
  const candidate = (value as Record<string, unknown>)[key];
  return candidate && typeof candidate === "object" ? candidate : null;
}

function buildStockSummary(data: unknown) {
  const name = readString(data, "name") || "Rhino stock";
  const faces = readNumber(data, "faceCount");
  return faces != null ? `${name} · ${faces.toLocaleString()} faces selected.` : `${name} selected.`;
}

function buildBoundarySummary(data: unknown) {
  const sourceKind = readString(data, "sourceKind") || "boundary";
  const pointCount = readNumber(data, "pointCount");
  const planeZ = readNumber(data, "planeZ");
  const sourceLabel = sourceKind === "brep-face" ? "Brep face" : "Closed curve";
  const zLabel = planeZ != null ? ` · Z ${trimNumber(planeZ)}` : "";
  return pointCount != null
    ? `${sourceLabel} · ${pointCount} points${zLabel}.`
    : `${sourceLabel} selected${zLabel}.`;
}

function buildToolpathSummary(data: unknown) {
  const curveCount = readNumber(data, "previewCurveCount");
  const pointCount = readNumber(data, "previewPointCount");
  if (curveCount != null && pointCount != null) {
    return `${curveCount} preview path${curveCount === 1 ? "" : "s"} · ${pointCount} points.`;
  }
  return "Toolpath generated and previewed in Rhino.";
}

function buildSimulationSummary(data: unknown) {
  const status = readString(data, "status") || "unknown";
  const progress = readNumber(data, "progressPercent");
  const message = readString(data, "message");
  const result = readObject(data, "result");
  if (status === "completed" && result) {
    const frameCount = readNumber(result, "frameCount");
    const chunkCount = readNumber(result, "chunkCount");
    return `Simulation complete${frameCount != null ? ` · ${frameCount} frames` : ""}${chunkCount != null ? ` · ${chunkCount} chunks` : ""}.`;
  }
  const progressLabel = progress != null ? ` (${Math.round(progress)}%)` : "";
  return `${capitalize(status)}${progressLabel}${message ? ` · ${message}` : ""}`;
}

function trimNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function capitalize(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value;
}

function addLog(kind: LogEntry["kind"], message: string, data?: unknown) {
  logs.unshift({ time: new Date().toLocaleTimeString(), kind, message, data });
  if (logs.length > 80) logs.pop();
}

async function run(type: string, payload?: Record<string, unknown>) {
  try {
    addLog("info", `sending ${type}`);
    render();
    const reply = await sendToRhino(type, payload);
    if (reply.data !== undefined) addLog("reply", `${type} data`, reply.data);
  } catch (error) {
    addLog("error", error instanceof Error ? error.message : String(error));
  } finally {
    render();
  }
}

function render() {
  app.innerHTML = `
    <main class="layout">
      <header class="topbar">
        <div>
          <div class="eyebrow">Rhino side panel</div>
          <h1>OpenCAM Viewer</h1>
          <p class="subtle">Minimal shadcn-style workflow for selection, toolpaths, and simulation fetch.</p>
        </div>
        <div class="badge-row">
          <span class="badge ${state.hasStock ? "badge-ok" : ""}">Stock</span>
          <span class="badge ${state.hasBoundary ? "badge-ok" : ""}">Pocket</span>
          <span class="badge ${state.hasOperation ? "badge-ok" : ""}">Toolpath</span>
          <span class="badge ${state.taskId ? "badge-ok" : ""}">Sim</span>
        </div>
      </header>

      <section class="panel-card section-stack">
        <div class="section-head">
          <div>
            <h2>Backend</h2>
            <p class="muted">Match the same API the browser frontend uses.</p>
          </div>
          <button class="btn btn-outline btn-sm" id="test-backend">Test</button>
        </div>
        <div class="field-stack">
          <label for="backend-url">Backend URL</label>
          <input id="backend-url" class="input" value="${escapeAttribute(state.backendUrl)}" />
        </div>
      </section>

      <section class="panel-card section-stack">
        <div class="section-head">
          <div>
            <h2>Selection</h2>
            <p class="muted">Use Rhino picks, then submit the same OpenCAM-style pocket request.</p>
          </div>
          <span class="inline-note">Preset pocket · Ø12 · z-step 6</span>
        </div>

        <div class="action-row">
          <button class="btn btn-outline btn-block" id="select-stock">Select stock</button>
          <p class="helper">${escapeHtml(state.stockSummary)}</p>
        </div>

        <div class="action-row">
          <button class="btn btn-outline btn-block" id="select-boundary" ${state.hasStock ? "" : "disabled"}>Select pocket area</button>
          <p class="helper">${escapeHtml(state.boundarySummary)}</p>
        </div>
      </section>

      <section class="panel-card section-stack">
        <div class="section-head">
          <div>
            <h2>Operation</h2>
            <p class="muted">Generate Rhino viewport toolpaths using the backend pocket engine.</p>
          </div>
        </div>

        <div class="action-row">
          <button class="btn btn-primary btn-block" id="generate" ${state.hasStock && state.hasBoundary ? "" : "disabled"}>Generate toolpath</button>
          <p class="helper">${escapeHtml(state.operationSummary)}</p>
        </div>
      </section>

      <section class="panel-card section-stack">
        <div class="section-head">
          <div>
            <h2>Simulation</h2>
            <p class="muted">Queue the swept simulation, then poll until the final Rhino meshes load.</p>
          </div>
        </div>

        <div class="button-grid">
          <button class="btn btn-primary" id="start-sim" ${state.hasOperation ? "" : "disabled"}>Start simulation</button>
          <button class="btn btn-outline" id="poll-sim" ${state.taskId ? "" : "disabled"}>Poll simulation</button>
          <button class="btn btn-ghost" id="clear-preview">Clear preview</button>
        </div>

        <p class="helper">${escapeHtml(state.simulationSummary)}</p>
      </section>

      <section class="panel-card section-stack log-card">
        <div class="section-head">
          <div>
            <h2>Event log</h2>
            <p class="muted">Bridge messages, backend replies, and simulation status.</p>
          </div>
        </div>
        <div id="log" class="log-list">${renderLogs()}</div>
      </section>
    </main>
  `;

  document.querySelector<HTMLInputElement>("#backend-url")?.addEventListener("input", (event) => {
    state.backendUrl = (event.currentTarget as HTMLInputElement).value;
  });
  document.querySelector("#test-backend")?.addEventListener("click", () => run("testBackend"));
  document.querySelector("#select-stock")?.addEventListener("click", () => run("selectStock"));
  document.querySelector("#select-boundary")?.addEventListener("click", () => run("selectPocketBoundary"));
  document.querySelector("#generate")?.addEventListener("click", () => run("generateToolpath"));
  document.querySelector("#start-sim")?.addEventListener("click", () => run("startSimulation"));
  document.querySelector("#poll-sim")?.addEventListener("click", () => run("pollSimulation", { taskId: state.taskId }));
  document.querySelector("#clear-preview")?.addEventListener("click", () => run("clearPreview"));
}

function renderLogs() {
  return logs.map((entry) => `
    <div class="log-entry ${entry.kind}">
      <div class="log-title">[${escapeHtml(entry.time)}] ${escapeHtml(entry.message)}</div>
      ${entry.data === undefined ? "" : `<pre>${escapeHtml(JSON.stringify(entry.data, null, 2))}</pre>`}
    </div>
  `).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

render();
void run("ping");
