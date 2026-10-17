/** Thin WebView UI: Python remains the source of truth for CAD/CAM state. */
type Action = "get_state" | "select_part" | "select_region" | "generate" | "simulate" | "compare" | "post_process" | "clear_preview";
type PanelEvent = { request_id: string; ok?: boolean; error?: string; cancelled?: boolean; state: { part?: { name: string }; region?: unknown; results?: Record<string, unknown> } };

export {};

declare global { interface Window { chrome?: { webview?: { postMessage(value: string): void; addEventListener(type: "message", handler: (event: MessageEvent<string>) => void): void } }; opencamRhino?: { receive(value: string): void } } }

const root = document.querySelector<HTMLElement>("#app")!;
let latest: PanelEvent | undefined;

function send(action: Action, payload: Record<string, unknown> = {}) {
  const request = JSON.stringify({ protocol_version: 1, action, payload, request_id: crypto.randomUUID() });
  window.chrome?.webview?.postMessage(request);
}
function render() {
  const part = latest?.state.part?.name ?? "No part selected";
  const region = latest?.state.region ? "Planar region selected" : "No planar region selected";
  root.innerHTML = `<main><h1>OpenCAM</h1><p>${part}</p><p>${region}</p><button data-action="select_part">Select polysurface part</button><button data-action="select_region">Select planar edge region</button><button data-action="generate" ${latest?.state.part && latest?.state.region ? "" : "disabled"}>Generate toolpath</button><button data-action="clear_preview" ${latest?.state.results?.toolpath_summary ? "" : "disabled"}>Clear preview</button><button disabled>Simulate (pending contract probe)</button><button disabled>Compare (pending contract probe)</button><pre>${latest?.error ?? "Ready"}</pre></main>`;
  root.querySelectorAll<HTMLButtonElement>("button[data-action]").forEach((button) => button.onclick = () => send(button.dataset.action as Action));
}
function receive(value: string) { latest = JSON.parse(value) as PanelEvent; render(); }
window.opencamRhino = { receive };
window.chrome?.webview?.addEventListener("message", (event) => receive(event.data));
render();
send("get_state");
