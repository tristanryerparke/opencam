/** OpenCAM Rhino panel UI. Python remains the source of truth; this is a thin, dumb view. */
type Action = "get_state" | "select_part" | "select_region" | "generate" | "generate_operation" | "add_setup" | "add_operation" | "update_operation" | "delete_operation" | "select_operation" | "set_visibility" | "set_backend_url" | "simulate" | "simulate_status" | "show_frame" | "compare" | "show_final" | "clear_preview" | "post_process";
type OperationSpec = { id: string; name: string; type: string; params: Record<string, unknown> };
type SetupSpec = { id: string; name: string; operations: OperationSpec[] };
type PartState = { name: string };
type PanelEvent = {
  request_id: string; ok?: boolean; error?: string; cancelled?: boolean;
  simulation_status?: string; frame_index?: number; frame_count?: number;
  record_count?: number; selected_operation_id?: string;
  state: {
    backend_url: string; part?: PartState; region?: unknown; setups: SetupSpec[];
    selected_operation_id?: string; visibility: Record<string, boolean>;
    results?: Record<string, unknown>;
  };
};

export {};

declare global { interface Window { chrome?: { webview?: { postMessage(value: string): void; addEventListener(type: "message", handler: (event: MessageEvent<string>) => void): void } }; opencamRhino?: { receive(value: string): void } } }

const root = document.querySelector<HTMLElement>("#app")!;
let latest: PanelEvent | undefined;
let frameIndex = 0;
let frameCount = 0;
let playing = false;
let speed = 1;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let playTimer: ReturnType<typeof setInterval> | undefined;
const debugLog: string[] = [];

const TYPE_LABELS: Record<string, string> = { pocketing_2d: "Pocket", profiling_2d: "Profile", parallel_finishing: "Parallel Finishing" };

function send(action: Action, payload: Record<string, unknown> = {}) {
  const request = JSON.stringify({ protocol_version: 1, action, payload, request_id: crypto.randomUUID() });
  window.chrome?.webview?.postMessage(request);
}
function log(line: string) { debugLog.push(line); if (debugLog.length > 40) debugLog.shift(); }
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => { if (["completed", "error", "cancelled"].includes(latest?.simulation_status ?? "")) stopPolling(); else send("simulate_status"); }, 1000);
}
function stopPolling() { if (pollTimer !== undefined) { clearInterval(pollTimer); pollTimer = undefined; } }
function stopPlayback() { playing = false; if (playTimer !== undefined) { clearInterval(playTimer); playTimer = undefined; } render(); }
function startPlayback() {
  if (frameCount < 1) return;
  if (frameIndex >= frameCount - 1) frameIndex = 0;
  playing = true;
  playTimer = setInterval(() => {
    if (!playing) return;
    if (frameIndex >= frameCount - 1) { stopPlayback(); return; }
    frameIndex += 1;
    send("show_frame", { frame_index: frameIndex });
  }, 1000 / (10 * speed));
  render();
}
function scrubTo(value: number) { frameIndex = Math.max(0, Math.min(frameCount - 1, value)); send("show_frame", { frame_index: frameIndex }); }

function operationDialogHtml(): string {
  const type = (document.querySelector<HTMLSelectElement>("#op-type")?.value ?? "pocketing_2d");
  const common = `
<label>Name <input id="op-name" type="text" value="${TYPE_LABELS[type] ?? "Operation"}"></label>
<label>Tool name <input id="op-tool-name" type="text" value="Flat end mill"></label>
<label>Tool number <input id="op-tool-number" type="number" value="1" min="1"></label>
<label>Tool diameter <input id="op-diameter" type="number" value="6" step="0.1" min="0.1"></label>
<label>Stepover % <input id="op-stepover" type="number" value="40" min="1" max="100"></label>
<label>Depth of cut <input id="op-doc" type="number" value="2" step="0.1" min="0"></label>
<label>Cut feedrate <input id="op-feed" type="number" value="800" min="1"></label>
<label>Spindle RPM <input id="op-rpm" type="number" value="18000" min="1"></label>
<label>Cut direction <select id="op-direction"><option value="climb">Climb</option><option value="conventional">Conventional</option></select></label>`;
  const perType: Record<string, string> = {
    pocketing_2d: `<label>Strategy <select id="op-strategy"><option value="offset">Offset</option><option value="adaptive">Adaptive</option></select></label>
<label>Keep tool down <input id="op-keep-down" type="checkbox" checked></label>`,
    profiling_2d: `<label>Side <select id="op-side"><option value="inside">Inside</option><option value="outside">Outside</option></select></label>`,
    parallel_finishing: `<label>Slice direction ° <input id="op-angle" type="number" value="0" min="0" max="179"></label>`,
  };
  return `<div id="op-dialog" class="dialog-backdrop"><div class="dialog">
<h2>Add operation</h2>
<label>Type <select id="op-type">${Object.entries(TYPE_LABELS).map(([value, label]) => `<option value="${value}" ${value === type ? "selected" : ""}>${label}</option>`).join("")}</select></label>
${common}${perType[type] ?? ""}
<div class="dialog-actions"><button id="op-cancel">Cancel</button><button id="op-add">Add</button></div>
</div></div>`;
}
function bindOperationDialog() {
  const dialog = document.querySelector("#op-dialog");
  if (!dialog) return;
  dialog.querySelector("#op-type")?.addEventListener("change", () => render(true));
  dialog.querySelector("#op-cancel")?.addEventListener("click", () => render());
  dialog.querySelector("#op-add")?.addEventListener("click", () => {
    const value = (id: string) => (document.querySelector<HTMLInputElement>(`#${id}`)?.value ?? "").trim();
    const checked = (id: string) => (document.querySelector<HTMLInputElement>(`#${id}`) as HTMLInputElement | null)?.checked ?? false;
    const type = value("op-type");
    const params: Record<string, unknown> = {
      tool_name: value("op-tool-name") || "Flat end mill",
      tool_number: Number(value("op-tool-number")) || 1,
      tool_diameter: Number(value("op-diameter")) || 6,
      stepover_percent: Number(value("op-stepover")) || 40,
      depth_of_cut: Number(value("op-doc")) || 2,
      cut_feedrate: Number(value("op-feed")) || 800,
      spindle_rpm: Number(value("op-rpm")) || 18000,
      cut_direction: value("op-direction") || "climb",
    };
    if (type === "pocketing_2d") { params.clearing_strategy = value("op-strategy"); params.keep_tool_down = checked("op-keep-down"); }
    if (type === "profiling_2d") params.side = value("op-side");
    if (type === "parallel_finishing") params.direction_degrees = Number(value("op-angle")) || 0;
    send("add_operation", { name: value("op-name") || TYPE_LABELS[type], type, params });
    render();
  });
}

function render(keepDialog = false) {
  if (!keepDialog) {
    const state = latest?.state;
    frameCount = (latest?.frame_count ?? 0) || (state?.results?.frame_count as number | undefined) || frameCount;
    if (latest?.frame_index !== undefined) frameIndex = latest.frame_index;
    const part = state?.part?.name ?? "No part selected";
    const region = state?.region ? "Planar region selected" : "No planar region selected";
    const selected = state?.selected_operation_id;
    const visibility = state?.visibility ?? {};
    const setups = state?.setups ?? [];
    const hasToolpath = Boolean(state?.results?.toolpath_summary);
    const simReady = frameCount > 0;
    const frameLabel = simReady ? `${frameIndex + 1} / ${frameCount}` : "No simulation";
    const status = latest?.simulation_status ? ` · ${latest.simulation_status}` : "";
    root.innerHTML = `<main>
<div class="row"><h1>OpenCAM</h1><span class="status ${latest?.error ? "bad" : ""}">${latest?.error ?? "Ready"}</span></div>
<div class="row"><button data-action="select_part">Select part</button><button data-action="select_region">Select region</button>
<span class="meta">${part} · ${region}</span></div>
<div class="row toggles">
${["stock", "part", "toolpath", "tool"].map((flag) => `<label><input type="checkbox" data-flag="${flag}" ${visibility[flag] !== false ? "checked" : ""}> ${flag[0].toUpperCase() + flag.slice(1)}</label>`).join("")}
</div>
<div class="row"><button id="add-operation">＋ Operation</button><button data-action="add_setup">＋ Setup</button><button data-action="generate" ${setups.some((s) => s.operations.length) ? "" : "disabled"}>Generate</button></div>
<div class="tree">${setups.length ? setups.map((setup) => `<div class="setup">${setup.name}<div>${setup.operations.map((op) => `
<div class="op ${op.id === selected ? "selected" : ""}" data-op="${op.id}">
<span class="op-name" data-select="${op.id}">${op.name}</span><span class="badge">${TYPE_LABELS[op.type] ?? op.type}</span>
<button data-gen="${op.id}" title="Generate">▶</button><button data-del="${op.id}" title="Delete">✕</button>
</div>`).join("")}</div></div>`).join("") : "<p class=\"empty\">No setups yet. Add an operation to create one.</p>"}</div>
<div class="row"><button data-action="simulate" ${hasToolpath ? "" : "disabled"}>Simulate</button>
<button data-frame="-1" ${simReady ? "" : "disabled"} title="Previous">◀</button>
<button id="play" ${simReady ? "" : "disabled"}>${playing ? "⏸" : "▶"}</button>
<button data-frame="1" ${simReady ? "" : "disabled"} title="Next">▶|</button>
<input id="timeline" type="range" min="0" max="${Math.max(frameCount - 1, 0)}" value="${frameIndex}" ${simReady ? "" : "disabled"}>
<span class="meta">${frameLabel}${status}</span>
<select id="speed" ${simReady ? "" : "disabled"}>${[0.25, 0.5, 1, 2, 4].map((s) => `<option value="${s}" ${s === speed ? "selected" : ""}>${s}×</option>`).join("")}</select></div>
<div class="row"><button data-action="compare" ${simReady ? "" : "disabled"}>Compare</button><button data-action="show_final" ${simReady ? "" : "disabled"}>Final stock</button><button data-action="clear_preview" ${hasToolpath || simReady ? "" : "disabled"}>Clear</button></div>
<details class="debug"><summary>Debug</summary>
<label>Backend <input id="backend-url" type="text" value="${state?.backend_url ?? "http://127.0.0.1:9090"}"><button id="set-backend">Set</button></label>
<pre>${debugLog.join("\n") || "No events yet."}</pre>
</details>
</main>`;
    root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
      button.onclick = () => {
        const action = button.dataset.action as Action;
        send(action);
        if (action === "simulate") startPolling();
        if (action === "clear_preview") { stopPlayback(); stopPolling(); frameCount = 0; frameIndex = 0; }
      };
    });
    root.querySelector("#add-operation")?.addEventListener("click", () => render(true));
    root.querySelectorAll<HTMLInputElement>("[data-flag]").forEach((box) => {
      box.onchange = () => send("set_visibility", { flags: { [box.dataset.flag!]: box.checked } });
    });
    root.querySelectorAll<HTMLElement>("[data-select]").forEach((element) => {
      element.onclick = () => send("select_operation", { operation_id: element.dataset.select });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-gen]").forEach((button) => {
      button.onclick = () => send("generate_operation", { operation_id: button.dataset.gen });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-del]").forEach((button) => {
      button.onclick = () => send("delete_operation", { operation_id: button.dataset.del });
    });
    root.querySelectorAll<HTMLButtonElement>("[data-frame]").forEach((button) => {
      button.onclick = () => { stopPlayback(); scrubTo(frameIndex + Number(button.dataset.frame)); };
    });
    root.querySelector("#play")?.addEventListener("click", () => (playing ? stopPlayback() : startPlayback()));
    root.querySelector("#timeline")?.addEventListener("input", (event) => scrubTo(Number((event.target as HTMLInputElement).value)));
    root.querySelector("#speed")?.addEventListener("change", (event) => { speed = Number((event.target as HTMLSelectElement).value); if (playing) { stopPlayback(); startPlayback(); } });
    root.querySelector("#set-backend")?.addEventListener("click", () => send("set_backend_url", { url: (root.querySelector("#backend-url") as HTMLInputElement).value }));
    if (keepDialog) { root.insertAdjacentHTML("beforeend", operationDialogHtml()); bindOperationDialog(); }
  } else {
    root.querySelector("#op-dialog")?.remove();
    root.insertAdjacentHTML("beforeend", operationDialogHtml());
    bindOperationDialog();
  }
}
function receive(value: string) {
  const event = JSON.parse(value) as PanelEvent;
  latest = event;
  log(`${event.request_id.slice(0, 8)} ${event.error ? "ERR " + event.error : "ok"}`);
  if (event.simulation_status === "completed") stopPolling();
  render();
}
window.opencamRhino = { receive };
window.chrome?.webview?.addEventListener("message", (event) => receive(event.data));
render();
send("get_state");
