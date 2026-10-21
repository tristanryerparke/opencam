/** OpenCAM Rhino panel. Native Eto dialogs own blocking add/edit operation control. */
import { contextMenu as createContextMenu } from "t-components/dom";

(() => {
type Action = "get_state" | "select_part" | "open_operation_dialog" | "generate_operation" | "generate_status" | "delete_operation" | "select_operation" | "set_visibility" | "simulate" | "simulate_status" | "show_frame";
type OperationSpec = { id: string; name: string; type: string };
type SetupSpec = { id: string; name: string; operations: OperationSpec[] };
type PanelEvent = {
  request_id: string; ok?: boolean; error?: string; cancelled?: boolean;
  selected_operation_id?: string; generation_status?: "running" | "completed" | "error"; generation_operation_id?: string;
  simulation_status?: string; frame_index?: number; frame_count?: number;
  state: { part?: { name: string }; setups: SetupSpec[]; selected_operation_id?: string; visibility: Record<string, boolean>; results?: Record<string, unknown> };
};
type Theme = { scheme: "light" | "dark"; tokens: Record<string, string> };
type ContextMenu = { operationId: string; x: number; y: number };
type GenerationState = { operationId: string; status: "starting" | "running"; startRequestId?: string };
type SimulationState = { operationId: string; status: string; frameIndex: number; frameCount: number; playing: boolean; speed: number; awaitingStart: boolean; startRequestId: string };

type PanelHostWindow = Window & {
  eto?: { postMessage(value: string): void };
  chrome?: { webview?: { postMessage(value: string): void; addEventListener(type: "message", handler: (event: MessageEvent<string>) => void): void } };
  opencamRhino?: { receive(value: string): void; theme(value: Theme): void };
};

const root = document.querySelector<HTMLElement>("#app")!;
const host = window as PanelHostWindow;
let latest: PanelEvent | undefined;
let contextMenu: ContextMenu | undefined;
const collapsedSetupIds = new Set<string>();
let generation: GenerationState | undefined;
let generationPoll: ReturnType<typeof setInterval> | undefined;
let simulation: SimulationState | undefined;
let simulationPoll: ReturnType<typeof setInterval> | undefined;
let simulationPlayback: ReturnType<typeof setInterval> | undefined;

function requestId() {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function send(action: Action, payload: Record<string, unknown> = {}) {
  const id = requestId();
  const request = JSON.stringify({ protocol_version: 1, action, payload, request_id: id });
  if (host.eto) host.eto.postMessage(request);
  else host.chrome?.webview?.postMessage(request);
  return id;
}
function stopGenerationPolling() {
  if (generationPoll !== undefined) clearInterval(generationPoll);
  generationPoll = undefined;
}
function pollGeneration() {
  if (generationPoll !== undefined) return;
  generationPoll = setInterval(() => send("generate_status"), 500);
}
function startRegeneration(operationId: string) {
  const startRequestId = send("generate_operation", { operation_id: operationId });
  generation = { operationId, status: "starting", startRequestId };
  render();
}
function stopSimulationPolling() {
  if (simulationPoll !== undefined) clearInterval(simulationPoll);
  simulationPoll = undefined;
}
function stopSimulationPlayback() {
  if (simulationPlayback !== undefined) clearInterval(simulationPlayback);
  simulationPlayback = undefined;
  if (simulation) simulation.playing = false;
}
function pollSimulation() {
  stopSimulationPolling();
  simulationPoll = setInterval(() => send("simulate_status"), 1000);
}
function startSimulation(operationId: string) {
  stopSimulationPlayback();
  const startRequestId = send("simulate", { operation_id: operationId });
  simulation = { operationId, status: "starting", frameIndex: 0, frameCount: 0, playing: false, speed: 1, awaitingStart: true, startRequestId };
}
function stepSimulation(delta: number) {
  if (!simulation || simulation.frameCount < 1) return;
  stopSimulationPlayback();
  simulation.frameIndex = Math.max(0, Math.min(simulation.frameCount - 1, simulation.frameIndex + delta));
  send("show_frame", { frame_index: simulation.frameIndex });
}
function toggleSimulationPlayback() {
  if (!simulation || simulation.frameCount < 1) return;
  if (simulation.playing) { stopSimulationPlayback(); render(); return; }
  if (simulation.frameIndex >= simulation.frameCount - 1) simulation.frameIndex = 0;
  simulation.playing = true;
  simulationPlayback = setInterval(() => {
    if (!simulation || simulation.frameIndex >= simulation.frameCount - 1) { stopSimulationPlayback(); render(); return; }
    simulation.frameIndex += 1;
    send("show_frame", { frame_index: simulation.frameIndex });
  }, 1000 / (10 * simulation.speed));
  render();
}
function simulationControlsHtml() {
  const current = simulation;
  if (!current) return "";
  const ready = current.frameCount > 0;
  const label = ready ? `${current.frameIndex + 1} / ${current.frameCount}` : current.status;
  return `<div class="simulation-controls"><div class="row"><strong>Simulation</strong><span class="meta">${label}</span></div>
<div class="row"><button data-sim="previous" ${ready ? "" : "disabled"}>◀</button><button data-sim="play" ${ready ? "" : "disabled"}>${current.playing ? "⏸" : "▶"}</button><button data-sim="next" ${ready ? "" : "disabled"}>▶|</button><input id="simulation-timeline" type="range" min="0" max="${Math.max(current.frameCount - 1, 0)}" value="${current.frameIndex}" ${ready ? "" : "disabled"}><select id="simulation-speed" ${ready ? "" : "disabled"}>${[0.25, 0.5, 1, 2, 4].map((speed) => `<option value="${speed}" ${speed === current.speed ? "selected" : ""}>${speed}×</option>`).join("")}</select></div></div>`;
}
function updateRunningSimulationControls() {
  if (!simulation) return;
  const label = root.querySelector<HTMLElement>(".simulation-controls .meta");
  const timeline = root.querySelector<HTMLInputElement>("#simulation-timeline");
  if (label) label.textContent = `${simulation.frameIndex + 1} / ${simulation.frameCount}`;
  if (timeline) timeline.value = String(simulation.frameIndex);
}
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function icon(name: "part" | "setup" | "check" | "x" | "loader" | "chevron-right" | "chevron-down") {
  const paths: Record<string, string> = {
    part: '<path d="M4 4h16v16H4z"/><path d="M8 8h8v8H8z"/>',
    setup: '<path d="m12 3-9 5 9 5 9-5-9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  };
  return `<svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function operationStatus(operation: OperationSpec) {
  const summaries = latest?.state.results?.toolpath_summaries as Record<string, unknown> | undefined;
  if (generation?.operationId === operation.id) return { className: "generating", iconName: "loader" as const, label: "Generating toolpath" };
  if (simulation?.operationId === operation.id && simulation.status === "completed") return { className: "simulated", iconName: "check" as const, label: "Simulation complete" };
  if (summaries?.[operation.id]) return { className: "generated", iconName: "check" as const, label: "Toolpath generated" };
  return { className: "missing", iconName: "x" as const, label: "Toolpath not generated" };
}

function treeHtml(state: PanelEvent["state"], setups: SetupSpec[], selected: string | undefined) {
  const part = state.part;
  const partName = part?.name ? `<span class="tree-file">${escapeHtml(part.name)}</span>` : "";
  const partStatus = part ? "" : '<span class="tree-status missing" aria-label="Part required">●</span>';
  const setupRows = setups.map((setup) => {
    const collapsed = collapsedSetupIds.has(setup.id);
    const toggle = icon(collapsed ? "chevron-right" : "chevron-down");
    const children = collapsed ? "" : setup.operations.map((operation) => {
      const status = operationStatus(operation);
      return `<div class="tree-indent" style="padding-left:16px"><button type="button" class="tree-row ${operation.id === selected ? "selected" : ""}" data-op="${operation.id}"><span class="tree-content"><span class="tree-label">${escapeHtml(operation.name)}</span></span><span class="tree-status ${status.className}" title="${status.label}">${icon(status.iconName)}</span></button></div>`;
    }).join("") || '<p class="empty">No operations yet.</p>';
    return `<div class="tree-indent"><button type="button" class="tree-row" data-setup="${setup.id}">${icon("setup")}<span class="tree-content"><span class="tree-label">${escapeHtml(setup.name)}</span></span><span class="tree-toggle" data-setup-toggle="${setup.id}">${toggle}</span></button></div>${children}`;
  }).join("");
  return `<div class="cam-tree"><div class="tree-indent"><button type="button" class="tree-row" data-action="select_part">${icon("part")}<span class="tree-content"><span class="tree-label">Part</span>${partName}</span>${partStatus}</button></div>${setupRows}</div>`;
}

function render() {
  const state = latest?.state;
  const selected = state?.selected_operation_id;
  const visibility = state?.visibility ?? {};
  const setups = state?.setups ?? [];
  const treeState = state ?? { setups: [], visibility: {} };
  root.innerHTML = `<main>
<div class="row toggles">${["stock", "part", "toolpath", "tool"].map((flag) => `<label><input type="checkbox" data-flag="${flag}" ${visibility[flag] !== false ? "checked" : ""}> ${flag[0].toUpperCase() + flag.slice(1)}</label>`).join("")}</div>
<div class="row"><button data-action="open_operation_dialog" ${state?.part && !generation ? "" : "disabled"}>Add Operation</button></div>
${treeHtml(treeState, setups, selected)}
${simulationControlsHtml()}
</main>`;
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.onclick = () => send(button.dataset.action as Action);
  });
  root.querySelectorAll<HTMLElement>("[data-setup-toggle]").forEach((toggle) => {
    toggle.onclick = (event) => {
      event.stopPropagation();
      const setupId = toggle.dataset.setupToggle;
      if (!setupId) return;
      if (collapsedSetupIds.has(setupId)) collapsedSetupIds.delete(setupId);
      else collapsedSetupIds.add(setupId);
      render();
    };
  });
  root.querySelectorAll<HTMLInputElement>("[data-flag]").forEach((box) => {
    box.onchange = () => send("set_visibility", { flags: { [box.dataset.flag!]: box.checked } });
  });
  root.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.sim === "previous") stepSimulation(-1);
      else if (button.dataset.sim === "next") stepSimulation(1);
      else if (button.dataset.sim === "play") toggleSimulationPlayback();
    };
  });
  root.querySelector("#simulation-timeline")?.addEventListener("input", (event) => {
    if (!simulation) return;
    simulation.frameIndex = Number((event.target as HTMLInputElement).value);
    stopSimulationPlayback();
    send("show_frame", { frame_index: simulation.frameIndex });
  });
  root.querySelector("#simulation-speed")?.addEventListener("change", (event) => {
    if (!simulation) return;
    const wasPlaying = simulation.playing;
    stopSimulationPlayback();
    simulation.speed = Number((event.target as HTMLSelectElement).value);
    if (wasPlaying) toggleSimulationPlayback();
  });
  root.querySelectorAll<HTMLElement>("[data-op]").forEach((element) => {
    element.onclick = () => {
      contextMenu = undefined;
      send("select_operation", { operation_id: element.dataset.op });
    };
    element.oncontextmenu = (event) => {
      event.preventDefault();
      contextMenu = { operationId: element.dataset.op!, x: event.clientX, y: event.clientY };
      send("select_operation", { operation_id: element.dataset.op });
      renderOverlay();
    };
  });
  root.onclick = () => {
    if (contextMenu) { contextMenu = undefined; renderOverlay(); }
  };
  renderOverlay();
}
function renderOverlay() {
  root.querySelector("[data-slot='context-menu-content']")?.remove();
  if (!contextMenu) return;
  const value = contextMenu;
  const summaries = latest?.state.results?.toolpath_summaries as Record<string, unknown> | undefined;
  const generated = Boolean(summaries?.[value.operationId]);
  const busy = generation !== undefined;
  const select = (action: "edit" | "simulate" | "regenerate" | "delete") => () => {
    contextMenu = undefined;
    if (action === "edit") send("open_operation_dialog", { operation_id: value.operationId });
    else if (action === "simulate") startSimulation(value.operationId);
    else if (action === "regenerate") startRegeneration(value.operationId);
    else send("delete_operation", { operation_id: value.operationId });
    renderOverlay();
  };
  const menu = createContextMenu({
    x: value.x,
    y: value.y,
    items: [
      { label: "Simulate", disabled: !generated || busy, onSelect: select("simulate") },
      { label: "Edit operation", disabled: busy, onSelect: select("edit") },
      { label: "Regenerate", disabled: busy, onSelect: select("regenerate") },
      { label: "Delete operation", disabled: busy, destructive: true, onSelect: select("delete") },
    ],
  });
  menu.style.width = "8rem";
  menu.style.minWidth = "8rem";
  menu.style.boxSizing = "border-box";
  root.append(menu);
}
function receive(value: string) {
  const event = JSON.parse(value) as PanelEvent;
  latest = event;
  const currentGeneration = generation;
  if (currentGeneration?.startRequestId === event.request_id && !event.generation_status) {
    stopGenerationPolling();
    generation = undefined;
  }
  if (event.generation_status === "running" && event.generation_operation_id) {
    generation = { operationId: event.generation_operation_id, status: "running" };
    pollGeneration();
  } else if (event.generation_status === "completed" || event.generation_status === "error") {
    stopGenerationPolling();
    generation = undefined;
  }
  const currentSimulation = simulation;
  let updateRunningControlsOnly = false;
  if (currentSimulation) {
    if (currentSimulation.awaitingStart && event.request_id === currentSimulation.startRequestId) {
      currentSimulation.awaitingStart = false;
      if (event.ok === false) simulation = undefined;
      else { currentSimulation.status = "queued"; pollSimulation(); }
    }
    if (event.simulation_status) {
      currentSimulation.status = event.simulation_status;
      currentSimulation.frameCount = event.frame_count ?? currentSimulation.frameCount;
      if (["completed", "cancelled", "error"].includes(currentSimulation.status)) stopSimulationPolling();
      if (["cancelled", "error"].includes(currentSimulation.status)) simulation = undefined;
    }
    if (event.frame_index !== undefined) {
      currentSimulation.frameIndex = event.frame_index;
      updateRunningControlsOnly = currentSimulation.playing;
    }
    if (event.frame_count !== undefined) currentSimulation.frameCount = event.frame_count;
  }
  if (updateRunningControlsOnly) updateRunningSimulationControls();
  else render();
}
function applyTheme(theme: Theme) {
  const tokens = theme.tokens;
  document.documentElement.style.colorScheme = theme.scheme;
  document.documentElement.classList.toggle("dark", theme.scheme === "dark");
  for (const [name, value] of Object.entries(tokens))
    document.documentElement.style.setProperty(`--${name}`, value);
  const componentColors: Record<string, string | undefined> = {
    "--background": tokens.bg,
    "--foreground": tokens.text,
    "--popover": tokens.surface,
    "--popover-foreground": tokens.text,
    "--accent": tokens["control-hover"],
    "--accent-foreground": tokens.text,
    "--destructive": tokens.accent,
    "--border": tokens.border,
    "--input": tokens.border,
    "--ring": tokens.accent,
  };
  for (const [name, value] of Object.entries(componentColors))
    if (value) document.documentElement.style.setProperty(name, value);
}
host.opencamRhino = { receive, theme: applyTheme };
host.chrome?.webview?.addEventListener("message", (event) => receive(event.data));
render();
send("get_state");
})();
