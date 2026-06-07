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
};

window.__openCamBridge = {
  receive(reply) {
    addLog(reply.ok ? "reply" : "error", `${reply.type}: ${reply.ok ? "ok" : reply.error ?? "failed"}`);

    if (reply.type === "selectStock" && reply.ok) state.hasStock = true;
    if (reply.type === "selectPocketBoundary" && reply.ok) state.hasBoundary = true;
    if (reply.type === "generateToolpath" && reply.ok) state.hasOperation = true;
    if (reply.type === "startSimulation" && reply.ok) {
      const taskId = readString(reply.data, "taskId");
      if (taskId) state.taskId = taskId;
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
    <main>
      <header>
        <div>
          <h1>OpenCAM Rhino</h1>
          <p>C# plugin + docked TypeScript UI</p>
        </div>
      </header>

      <section class="card">
        <label for="backend-url">Backend URL</label>
        <div class="row">
          <input id="backend-url" value="${escapeAttribute(state.backendUrl)}" />
          <button id="test-backend">Test</button>
        </div>
      </section>

      <section class="card steps">
        <button id="select-stock">1. Select stock</button>
        <button id="select-boundary" ${state.hasStock ? "" : "disabled"}>2. Select pocket area</button>
        <button id="generate" ${state.hasStock && state.hasBoundary ? "" : "disabled"}>3. Generate toolpath</button>
        <button id="start-sim" ${state.hasOperation ? "" : "disabled"}>4. Start simulation</button>
        <button id="poll-sim" ${state.taskId ? "" : "disabled"}>Poll simulation</button>
        <button id="clear-preview">Clear preview</button>
      </section>

      <section class="status-grid">
        <div class="status ${state.hasStock ? "ok" : ""}">Stock</div>
        <div class="status ${state.hasBoundary ? "ok" : ""}">Pocket</div>
        <div class="status ${state.hasOperation ? "ok" : ""}">Toolpath</div>
        <div class="status ${state.taskId ? "ok" : ""}">Simulation</div>
      </section>

      <section class="card">
        <h2>Log</h2>
        <div id="log">${renderLogs()}</div>
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
      <div>[${escapeHtml(entry.time)}] ${escapeHtml(entry.message)}</div>
      ${entry.data === undefined ? "" : `<pre>${escapeHtml(JSON.stringify(entry.data, null, 2))}</pre>`}
    </div>
  `).join("");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char] ?? char));
}

function escapeAttribute(value: string) {
  return escapeHtml(value);
}

render();
void run("ping");
