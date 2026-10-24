import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

/** OpenCAM Rhino panel. Native Eto dialogs own blocking add/edit operation control. */
import { mountRhinoAddOperationButton, mountRhinoContextMenu, mountRhinoOperationTree, mountRhinoVisibilityPicker } from "./rhino-panel-components";

function mountPanelDom(root: HTMLElement) {
type Action = "get_state" | "select_part" | "remove_part" | "open_operation_dialog" | "import_operations" | "generate_operation" | "generate_status" | "delete_operation" | "duplicate_operation" | "reorder_operations" | "select_operation" | "set_visibility" | "simulate" | "simulate_status" | "show_frame" | "exit_simulation" | "post_process" | "post_process_setup";
type OperationSpec = { id: string; name: string; type: string };
type SetupSpec = { id: string; name: string; operations: OperationSpec[] };
type PanelEvent = {
  request_id: string; ok?: boolean; error?: string; cancelled?: boolean;
  selected_operation_id?: string; generation_status?: "running" | "completed" | "error"; generation_operation_id?: string;
  simulation_status?: string; simulation_operation_id?: string; frame_index?: number; frame_count?: number;
  state: { part?: { name: string }; setups: SetupSpec[]; selected_operation_id?: string; visibility: Record<string, boolean>; results?: Record<string, unknown> };
};
type Theme = { scheme: "light" | "dark"; tokens: Record<string, string> };
type ContextMenu =
  | { kind: "operation"; operationId: string; x: number; y: number }
  | { kind: "setup"; setupId: string; x: number; y: number }
  | { kind: "part"; x: number; y: number };
type GenerationState = { operationId: string; status: "starting" | "running"; startRequestId?: string };
type SetupRegeneration = { setupId: string; remainingOperationIds: string[]; currentOperationId?: string; waitingForSimulation: boolean };
type SimulationState = { operationId: string; status: string; frameIndex: number; frameCount: number; sourceFrameCount: number; stride: number; playing: boolean; awaitingStart: boolean; pendingFrame: boolean; startRequestId: string };

type PanelHostWindow = Window & {
  eto?: { postMessage(value: string): void };
  chrome?: { webview?: { postMessage(value: string): void; addEventListener(type: "message", handler: (event: MessageEvent<string>) => void): void } };
  opencamRhino?: { receive(value: string): void; theme(value: Theme): void };
};

const host = window as PanelHostWindow;
const operationTypeLabels: Record<string, string> = {
  pocketing_2d: "2.5D Pocketing",
  profiling_2d: "2.5D Profiling",
  facing_2d: "2.5D Facing",
  parallel_finishing: "3D Parallel Finishing",
};
let latest: PanelEvent | undefined;
let contextMenu: ContextMenu | undefined;
let generation: GenerationState | undefined;
let setupRegeneration: SetupRegeneration | undefined;
let generationPoll: ReturnType<typeof setInterval> | undefined;
let simulation: SimulationState | undefined;
let simulationPoll: ReturnType<typeof setInterval> | undefined;
let simulationPlayback: ReturnType<typeof setInterval> | undefined;
const SIMULATION_STRIDE_OPTIONS = [1, 2, 4, 8, 16] as const;
const SIMULATION_PLAYBACK_INTERVAL_MS = 30;

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
  generationPoll = setInterval(() => send("generate_status"), 2000);
}
function startRegeneration(operationId: string) {
  closeSimulationView(true);
  const startRequestId = send("generate_operation", { operation_id: operationId });
  generation = { operationId, status: "starting", startRequestId };
  render();
}
function continueSetupRegeneration() {
  if (!setupRegeneration || generation) return;
  const operationId = setupRegeneration.remainingOperationIds.shift();
  if (!operationId) {
    setupRegeneration = undefined;
    render();
    return;
  }
  setupRegeneration.currentOperationId = operationId;
  setupRegeneration.waitingForSimulation = false;
  startRegeneration(operationId);
}
function startSetupRegeneration(setupId: string) {
  const setup = latest?.state.setups.find((candidate) => candidate.id === setupId);
  if (!setup || setup.operations.length === 0 || generation || setupRegeneration) return;
  setupRegeneration = {
    setupId,
    remainingOperationIds: setup.operations.map((operation) => operation.id),
    waitingForSimulation: false,
  };
  continueSetupRegeneration();
}
function finishSetupRegenerationOperation() {
  if (!setupRegeneration) return;
  setupRegeneration.currentOperationId = undefined;
  setupRegeneration.waitingForSimulation = false;
  continueSetupRegeneration();
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
  simulationPoll = setInterval(
    () => send("simulate_status", { display: simulation !== undefined }),
    2000,
  );
}
function simulationFrameIndices(sourceFrameCount: number, stride: number) {
  if (sourceFrameCount < 1) return [];
  const indices = Array.from(
    { length: Math.ceil(sourceFrameCount / stride) },
    (_, index) => index * stride,
  ).filter((index) => index < sourceFrameCount);
  if (indices[indices.length - 1] !== sourceFrameCount - 1) indices.push(sourceFrameCount - 1);
  return indices;
}
function updateSimulationFrameCount(current: SimulationState) {
  current.frameCount = simulationFrameIndices(current.sourceFrameCount, current.stride).length;
  current.frameIndex = Math.max(0, Math.min(current.frameIndex, Math.max(current.frameCount - 1, 0)));
}
function showSimulationFrame(frameIndex: number) {
  if (!simulation || simulation.frameCount < 1) return;
  simulation.frameIndex = Math.max(0, Math.min(simulation.frameCount - 1, frameIndex));
  const sourceIndex = simulationFrameIndices(simulation.sourceFrameCount, simulation.stride)[simulation.frameIndex];
  simulation.pendingFrame = true;
  send("show_frame", { frame_index: sourceIndex });
}
function closeSimulationView(notifyHost: boolean) {
  if (!simulation) return;
  stopSimulationPlayback();
  stopSimulationPolling();
  simulation = undefined;
  if (notifyHost) send("exit_simulation");
}
function startSimulation(operationId: string) {
  closeSimulationView(true);
  const startRequestId = send("simulate", { operation_id: operationId });
  simulation = { operationId, status: "starting", frameIndex: 0, frameCount: 0, sourceFrameCount: 0, stride: 1, playing: false, awaitingStart: true, pendingFrame: false, startRequestId };
  render();
}
function stepSimulation(delta: number) {
  if (!simulation || simulation.frameCount < 1) return;
  stopSimulationPlayback();
  showSimulationFrame(simulation.frameIndex + delta);
}
function toggleSimulationPlayback() {
  if (!simulation || simulation.frameCount < 1) return;
  if (simulation.playing) { stopSimulationPlayback(); render(); return; }
  if (simulation.frameIndex >= simulation.frameCount - 1) showSimulationFrame(0);
  simulation.playing = true;
  simulationPlayback = setInterval(() => {
    if (!simulation) return;
    if (simulation.frameIndex >= simulation.frameCount - 1) { stopSimulationPlayback(); render(); return; }
    if (simulation.pendingFrame) return;
    showSimulationFrame(simulation.frameIndex + 1);
  }, SIMULATION_PLAYBACK_INTERVAL_MS);
  render();
}
function visibilityHtml(_visibility: Record<string, boolean>) {
  return '<div id="rhino-react-visibility-picker" style="display:block;width:100%;min-width:0"></div>';
}
function simulationControlsHtml() {
  const current = simulation!;
  const ready = current.frameCount > 0;
  const atStart = current.frameIndex <= 0;
  const atEnd = current.frameIndex >= current.frameCount - 1;
  const label = ready ? `${current.frameIndex + 1} / ${current.frameCount}` : current.status;
  const strideIndex = SIMULATION_STRIDE_OPTIONS.indexOf(current.stride as typeof SIMULATION_STRIDE_OPTIONS[number]);
  return `<div class="simulation-controls"><div class="simulation-transport-row">
<button data-sim="skip-start" title="Skip to beginning" ${ready && !atStart ? "" : "disabled"}>|◀</button>
<button data-sim="previous" title="Step back" ${ready && !atStart ? "" : "disabled"}>◀</button>
<button data-sim="play" title="${current.playing ? "Pause" : "Play"}" ${ready && current.frameCount > 1 ? "" : "disabled"}>${current.playing ? "⏸" : "▶"}</button>
<button data-sim="next" title="Step forward" ${ready && !atEnd ? "" : "disabled"}>▶</button>
<button data-sim="skip-end" title="Skip to end" ${ready && !atEnd ? "" : "disabled"}>▶|</button>
<label class="simulation-stride-control" title="Simulation frame stride: ${current.stride}×"><span>Stride <output>${current.stride}×</output></span><input id="simulation-stride" aria-label="Simulation frame stride" type="range" min="0" max="${SIMULATION_STRIDE_OPTIONS.length - 1}" step="1" value="${Math.max(strideIndex, 0)}" ${ready ? "" : "disabled"}></label>
<span class="simulation-progress meta">${label}</span>
<button data-sim="exit" title="Exit simulation" aria-label="Exit simulation">✕</button>
</div>
<input id="simulation-timeline" aria-label="Simulation timeline" type="range" min="0" max="${Math.max(current.frameCount - 1, 0)}" value="${current.frameIndex}" ${ready ? "" : "disabled"}>
</div>`;
}
function updateRunningSimulationControls() {
  if (!simulation) return;
  const label = root.querySelector<HTMLElement>(".simulation-progress");
  const timeline = root.querySelector<HTMLInputElement>("#simulation-timeline");
  if (label) label.textContent = `${simulation.frameIndex + 1} / ${simulation.frameCount}`;
  if (timeline) timeline.value = String(simulation.frameIndex);
}
function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function icon(name: "part" | "setup" | "grip" | "check" | "x" | "dot" | "loader" | "chevron-right" | "chevron-down") {
  const paths: Record<string, string> = {
    part: '<path d="M21 11a8 8 0 0 0-8-8"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>',
    setup: '<path d="M5 3v16h16"/><path d="m5 19 6-6"/><path d="m2 6 3-3 3 3"/><path d="m18 16 3 3-3 3"/>',
    grip: '<circle cx="9" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="5" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="9" cy="19" r="1" fill="currentColor" stroke="none"/><circle cx="15" cy="19" r="1" fill="currentColor" stroke="none"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    dot: '<circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/>',
    loader: '<path d="M21 12a9 9 0 1 1-6.219-8.56"/>',
    "chevron-right": '<path d="m9 18 6-6-6-6"/>',
    "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  };
  return `<svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function operationStatus(operation: OperationSpec) {
  const summaries = latest?.state.results?.toolpath_summaries as Record<string, unknown> | undefined;
  if (generation?.operationId === operation.id) return { className: "generating", iconName: "loader" as const, label: "Generating toolpath" };
  const invalidOperationIds = latest?.state.results?.invalid_operation_ids;
  if (Array.isArray(invalidOperationIds) && invalidOperationIds.includes(operation.id)) return { className: "invalid", iconName: "x" as const, label: "Source geometry changed; regenerate toolpath" };
  const simulationSummaries = latest?.state.results?.simulation_summaries as Record<string, { status?: string }> | undefined;
  const simulationSummary = simulationSummaries?.[operation.id];
  if (simulationSummary?.status === "running") return { className: "generating", iconName: "loader" as const, label: "Preparing simulation" };
  if ((simulation?.operationId === operation.id && simulation.status === "completed") || simulationSummary?.status === "completed") return { className: "simulated", iconName: "check" as const, label: "Simulation complete" };
  if (summaries?.[operation.id]) return { className: "generated", iconName: "check" as const, label: "Toolpath generated" };
  return { className: "missing", iconName: "x" as const, label: "Toolpath not generated" };
}

function treeHtml(state: PanelEvent["state"]) {
  const part = state.part;
  const partName = part?.name ? `<span class="tree-file">${escapeHtml(part.name)}</span>` : "";
  const partStatus = part ? "" : '<span class="tree-status missing" aria-label="Part required">●</span>';
  return `<div class="cam-tree"><div class="tree-indent"><button type="button" class="tree-row" data-action="select_part" data-part-reference="${part ? "present" : "missing"}">${icon("part")}<span class="tree-content"><span class="tree-label">Part</span>${partName}</span>${partStatus}</button></div><div id="rhino-react-operation-tree"></div></div>`;
}

function render() {
  const state = latest?.state;
  const selected = state?.selected_operation_id;
  const visibility = state?.visibility ?? {};
  const setups = state?.setups ?? [];
  const treeState = state ?? { setups: [], visibility: {} };
  root.innerHTML = simulation
    ? `<main class="simulation-page"><div class="simulation-header"><strong>Simulation</strong><span class="meta">${escapeHtml(simulation.status)}</span></div>${visibilityHtml(visibility)}${simulationControlsHtml()}</main>`
    : `<main>${visibilityHtml(visibility)}
<div class="row"><div id="rhino-react-add-operation-button"></div><button type="button" id="import-operations-button">Import Operations</button></div>
${treeHtml(treeState)}
</main>`;
  const operationTreeElement = root.querySelector<HTMLElement>("#rhino-react-operation-tree");
  const setup = setups[0];
  if (operationTreeElement && setup) {
    mountRhinoOperationTree(operationTreeElement, {
      setup,
      selectedOperationId: selected,
      statusFor: operationStatus,
      onSelect: (operationId) => send("select_operation", { operation_id: operationId }),
      onOperationContextMenu: (operationId, event) => {
        event.preventDefault();
        contextMenu = { kind: "operation", operationId, x: event.clientX, y: event.clientY };
        send("select_operation", { operation_id: operationId });
        renderOverlay();
      },
      onSetupContextMenu: (event) => {
        event.preventDefault();
        contextMenu = { kind: "setup", setupId: setup.id, x: event.clientX, y: event.clientY };
        renderOverlay();
      },
      onReorder: (operationIds) => send("reorder_operations", { setup_id: setup.id, operation_ids: operationIds }),
    });
  }
  const visibilityPickerElement = root.querySelector<HTMLElement>("#rhino-react-visibility-picker");
  const addOperationButtonElement = root.querySelector<HTMLElement>("#rhino-react-add-operation-button");
  const importOperationsButton = root.querySelector<HTMLButtonElement>("#import-operations-button");
  const busy = Boolean(generation || setupRegeneration);
  if (visibilityPickerElement) mountRhinoVisibilityPicker(visibilityPickerElement, visibility, simulation !== undefined, (flag, value) => send("set_visibility", { flags: { [flag]: value } }));
  if (addOperationButtonElement) mountRhinoAddOperationButton(addOperationButtonElement, busy, () => send("open_operation_dialog"));
  if (importOperationsButton) {
    importOperationsButton.disabled = busy;
    importOperationsButton.onclick = () => send("import_operations");
  }
  root.querySelectorAll<HTMLButtonElement>("[data-action]").forEach((button) => {
    button.onclick = () => send(button.dataset.action as Action);
  });
  const partElement = root.querySelector<HTMLElement>("[data-part-reference='present']");
  if (partElement) {
    partElement.oncontextmenu = (event) => {
      event.preventDefault();
      contextMenu = { kind: "part", x: event.clientX, y: event.clientY };
      renderOverlay();
    };
  }
  root.querySelectorAll<HTMLButtonElement>("[data-sim]").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.sim === "skip-start") { stopSimulationPlayback(); showSimulationFrame(0); }
      else if (button.dataset.sim === "previous") stepSimulation(-1);
      else if (button.dataset.sim === "next") stepSimulation(1);
      else if (button.dataset.sim === "skip-end" && simulation) { stopSimulationPlayback(); showSimulationFrame(simulation.frameCount - 1); }
      else if (button.dataset.sim === "play") toggleSimulationPlayback();
      else if (button.dataset.sim === "exit") { closeSimulationView(true); render(); }
    };
  });
  root.querySelector("#simulation-timeline")?.addEventListener("input", (event) => {
    stopSimulationPlayback();
    showSimulationFrame(Number((event.target as HTMLInputElement).value));
  });
  root.querySelector("#simulation-stride")?.addEventListener("input", (event) => {
    if (!simulation) return;
    stopSimulationPlayback();
    const progress = simulation.frameCount > 1 ? simulation.frameIndex / (simulation.frameCount - 1) : 0;
    const optionIndex = Number((event.target as HTMLInputElement).value);
    simulation.stride = SIMULATION_STRIDE_OPTIONS[optionIndex] ?? 1;
    updateSimulationFrameCount(simulation);
    simulation.frameIndex = Math.round(progress * Math.max(simulation.frameCount - 1, 0));
    showSimulationFrame(simulation.frameIndex);
    render();
  });
  renderOverlay();
}
function closeContextMenu() {
  if (!contextMenu) return;
  contextMenu = undefined;
  renderOverlay();
}
function dismissContextMenuOnPanelPointer(event: PointerEvent) {
  if (!contextMenu) return;
  const target = event.target;
  if (target instanceof Element && target.closest("[data-slot='opencam-context-menu']")) return;
  closeContextMenu();
}
function renderOverlay() {
  let element = root.querySelector<HTMLElement>("#rhino-react-context-menu");
  if (!element) {
    element = document.createElement("div");
    element.id = "rhino-react-context-menu";
    root.append(element);
  }
  const value = contextMenu;
  const summaries = latest?.state.results?.toolpath_summaries as Record<string, unknown> | undefined;
  const invalidOperationIds = latest?.state.results?.invalid_operation_ids;
  const isInvalid = (operationId: string) => Array.isArray(invalidOperationIds) && invalidOperationIds.includes(operationId);
  const setup = value?.kind === "setup" ? latest?.state.setups.find((candidate) => candidate.id === value.setupId) : undefined;
  const operationId = value?.kind === "operation" ? value.operationId : "";
  const busy = generation !== undefined || setupRegeneration !== undefined;
  mountRhinoContextMenu(element, value, {
    close: closeContextMenu,
    operationGenerated: Boolean(operationId && summaries?.[operationId] && !isInvalid(operationId)),
    setupHasOperations: Boolean(setup?.operations.length),
    setupGenerated: Boolean(setup?.operations.length && setup.operations.every((operation) => summaries?.[operation.id] && !isInvalid(operation.id))),
    busy,
    simulate: () => startSimulation(operationId),
    postProcess: () => send("post_process", { operation_id: operationId }),
    edit: () => send("open_operation_dialog", { operation_id: operationId }),
    regenerate: () => startRegeneration(operationId),
    duplicate: () => send("duplicate_operation", { operation_id: operationId }),
    delete: () => send("delete_operation", { operation_id: operationId }),
    regenerateSetup: () => { if (setup) startSetupRegeneration(setup.id); },
    postProcessSetup: () => { if (setup) send("post_process_setup", { setup_id: setup.id }); },
    removePart: () => send("remove_part"),
  });
}
function receive(value: string) {
  const event = JSON.parse(value) as PanelEvent;
  latest = event;
  if (event.ok === false && event.error) window.alert(event.error);
  const currentGeneration = generation;
  let advanceSetupRegeneration = false;
  if (currentGeneration?.startRequestId === event.request_id && !event.generation_status) {
    stopGenerationPolling();
    generation = undefined;
    if (setupRegeneration?.currentOperationId === currentGeneration.operationId)
      advanceSetupRegeneration = true;
  }
  if (event.generation_status === "running" && event.generation_operation_id) {
    closeSimulationView(false);
    generation = { operationId: event.generation_operation_id, status: "running" };
    pollGeneration();
  } else if (event.generation_status === "completed" || event.generation_status === "error") {
    stopGenerationPolling();
    generation = undefined;
    const activeSetupRegeneration = setupRegeneration;
    if (activeSetupRegeneration && activeSetupRegeneration.currentOperationId === event.generation_operation_id) {
      const simulationStarted = event.generation_status === "completed"
        && event.simulation_operation_id === event.generation_operation_id
        && event.simulation_status != null
        && !["completed", "cancelled", "error"].includes(event.simulation_status);
      activeSetupRegeneration.waitingForSimulation = simulationStarted;
      advanceSetupRegeneration = !simulationStarted;
    }
  }
  const currentSimulation = simulation;
  let updateRunningControlsOnly = false;
  if (event.simulation_status && !currentSimulation) {
    if (["completed", "cancelled", "error"].includes(event.simulation_status)) stopSimulationPolling();
    else pollSimulation();
  }
  if (currentSimulation) {
    if (currentSimulation.awaitingStart && event.request_id === currentSimulation.startRequestId) {
      currentSimulation.awaitingStart = false;
      currentSimulation.pendingFrame = false;
      if (event.ok === false) simulation = undefined;
      else if (!event.simulation_status) { currentSimulation.status = "queued"; pollSimulation(); }
    }
    if (event.simulation_status) {
      currentSimulation.status = event.simulation_status;
      if (!["completed", "cancelled", "error"].includes(currentSimulation.status)) pollSimulation();
      else stopSimulationPolling();
      if (["cancelled", "error"].includes(currentSimulation.status)) simulation = undefined;
    }
    if (event.frame_count !== undefined) {
      currentSimulation.sourceFrameCount = event.frame_count;
      updateSimulationFrameCount(currentSimulation);
    }
    if (event.frame_index !== undefined) {
      currentSimulation.pendingFrame = false;
      const indices = simulationFrameIndices(currentSimulation.sourceFrameCount, currentSimulation.stride);
      const exact = indices.indexOf(event.frame_index);
      if (exact >= 0) currentSimulation.frameIndex = exact;
      updateRunningControlsOnly = currentSimulation.playing;
    }
  }
  if (
    setupRegeneration?.waitingForSimulation
    && event.simulation_operation_id === setupRegeneration.currentOperationId
    && event.simulation_status != null
    && ["completed", "cancelled", "error"].includes(event.simulation_status)
  ) {
    advanceSetupRegeneration = true;
  }
  if (advanceSetupRegeneration) finishSetupRegenerationOperation();
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
    "--popover": tokens.bg,
    "--popover-foreground": tokens.text,
    "--accent": tokens["control-hover"],
    "--accent-foreground": tokens.text,
    "--destructive": "#ef4444",
    "--border": tokens.border,
    "--input": tokens.border,
    "--ring": tokens.accent,
  };
  for (const [name, value] of Object.entries(componentColors))
    if (value) document.documentElement.style.setProperty(name, value);
}
host.opencamRhino = { receive, theme: applyTheme };
host.chrome?.webview?.addEventListener("message", (event) => receive(event.data));
document.addEventListener("pointerdown", dismissContextMenuOnPanelPointer, true);
window.addEventListener("blur", closeContextMenu);
render();
}

function PanelRoot() {
  return <div ref={(element) => { if (element && !element.dataset.mounted) { element.dataset.mounted = "true"; mountPanelDom(element); } }} className="h-full" />;
}

const panelElement = document.querySelector<HTMLElement>("#app");
if (!panelElement) throw new Error("OpenCAM panel root is missing.");
flushSync(() => createRoot(panelElement).render(<PanelRoot />));
