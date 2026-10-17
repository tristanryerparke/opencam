/** Thin WebView UI: Python remains the source of truth for CAD/CAM state. */
type Action = "get_state" | "select_part" | "select_region" | "generate" | "simulate" | "simulate_status" | "show_frame" | "compare" | "show_final" | "clear_preview" | "post_process";
type PanelEvent = {
  request_id: string; ok?: boolean; error?: string; cancelled?: boolean;
  simulation_status?: string; frame_index?: number; frame_count?: number;
  state: { part?: { name: string }; region?: unknown; results?: Record<string, unknown> };
};

export {};

declare global { interface Window { chrome?: { webview?: { postMessage(value: string): void; addEventListener(type: "message", handler: (event: MessageEvent<string>) => void): void } }; opencamRhino?: { receive(value: string): void } } }

const root = document.querySelector<HTMLElement>("#app")!;
let latest: PanelEvent | undefined;
let frameIndex = 0;
let frameCount = 0;
let pollTimer: ReturnType<typeof setInterval> | undefined;

function send(action: Action, payload: Record<string, unknown> = {}) {
  const request = JSON.stringify({ protocol_version: 1, action, payload, request_id: crypto.randomUUID() });
  window.chrome?.webview?.postMessage(request);
}
function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (latest?.simulation_status && ["completed", "error", "cancelled"].includes(latest.simulation_status)) stopPolling();
    else send("simulate_status");
  }, 1000);
}
function stopPolling() { if (pollTimer !== undefined) { clearInterval(pollTimer); pollTimer = undefined; } }
function stepFrame(delta: number) {
  const next = Math.max(0, Math.min((latest?.frame_count ?? frameCount) - 1, (latest?.frame_index ?? frameIndex) + delta));
  frameIndex = next;
  send("show_frame", { frame_index: next });
}
function render() {
  const part = latest?.state.part?.name ?? "No part selected";
  const region = latest?.state.region ? "Planar region selected" : "No planar region selected";
  const hasToolpath = Boolean(latest?.state.results?.toolpath_summary);
  frameCount = (latest?.frame_count ?? 0) || frameCount;
  frameIndex = latest?.frame_index ?? frameIndex;
  const simReady = frameCount > 0;
  const frameLabel = simReady ? `Frame ${(latest?.frame_index ?? frameIndex) + 1} / ${frameCount}` : "No simulation";
  const status = latest?.simulation_status ? ` · ${latest.simulation_status}` : "";
  root.innerHTML = `<main><h1>OpenCAM</h1><p>${part}</p><p>${region}</p>
<button data-action="select_part">Select polysurface part</button>
<button data-action="select_region">Select planar edge region</button>
<button data-action="generate" ${latest?.state.part && latest?.state.region ? "" : "disabled"}>Generate toolpath</button>
<button data-action="simulate" ${hasToolpath ? "" : "disabled"}>Simulate</button>
<button data-action="frame" data-delta="-1" ${simReady ? "" : "disabled"}>◀</button>
<span>${frameLabel}${status}</span>
<button data-action="frame" data-delta="1" ${simReady ? "" : "disabled"}>▶</button>
<button data-action="compare" ${simReady ? "" : "disabled"}>Compare</button>
<button data-action="show_final" ${simReady ? "" : "disabled"}>Final stock</button>
<button data-action="clear_preview" ${hasToolpath || simReady ? "" : "disabled"}>Clear preview</button>
<pre>${latest?.error ?? "Ready"}</pre></main>`;
  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => {
    button.onclick = () => {
      if (button.dataset.action === "frame") stepFrame(Number(button.dataset.delta));
      else {
        send(button.dataset.action as Action);
        if (button.dataset.action === "simulate") startPolling();
      }
    };
  });
}
function receive(value: string) {
  const event = JSON.parse(value) as PanelEvent;
  latest = event;
  if (event.simulation_status && ["completed", "error", "cancelled"].includes(event.simulation_status)) stopPolling();
  render();
}
window.opencamRhino = { receive };
window.chrome?.webview?.addEventListener("message", (event) => receive(event.data));
render();
send("get_state");
