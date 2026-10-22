import { button, checkbox, input, label, select, sidebar, table } from "t-components/dom";

type Region = Record<string, unknown>;
type Theme = { scheme: "light" | "dark"; tokens: Record<string, string> };
type Tool = { id: string; name: string; toolNumber: number; diameter: number; cuttingHeight: number; shoulderHeight: number; numFlutes: number };
type Draft = { name: string; type: string; params: Record<string, unknown>; regions: Region[] };
type Page = "geometry" | "cut" | "tool" | "feeds" | "levels" | "clearance" | "advanced";

type OperationHostWindow = Window & {
  eto?: { postMessage(value: string): void };
  chrome?: { webview?: { postMessage(value: string): void } };
  opencamOperation?: { initialize(value: { draft?: Draft; backend_url?: string }): void; theme(value: Theme): void };
};

const root = document.querySelector<HTMLElement>("#app")!;
const host = window as OperationHostWindow;
const labels: Record<string, string> = {
  pocketing_2d: "2.5D Pocketing",
  profiling_2d: "2.5D Profiling",
  facing_2d: "2.5D Facing",
  parallel_finishing: "3D Parallel Finishing",
};
const pages: { id: Page; label: string }[] = [
  { id: "geometry", label: "Drive Geometry" }, { id: "cut", label: "Cut Parameters" },
  { id: "tool", label: "Tool" }, { id: "feeds", label: "Feeds and Speeds" },
  { id: "levels", label: "Levels" }, { id: "clearance", label: "Clearance" },
  { id: "advanced", label: "Advanced" },
];
let draft: Draft | undefined;
let page: Page = "geometry";
let backendUrl = "";
let tools: Tool[] = [];
let toolsLoading = false;

function send(value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  if (host.eto) host.eto.postMessage(json);
  else host.chrome?.webview?.postMessage(json);
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme.scheme === "dark");
  document.documentElement.style.colorScheme = theme.scheme;
}

function defaults(type: string): Record<string, unknown> {
  const common = {
    tool_name: "Flat end mill", tool_number: 1, tool_diameter: 6, cutting_height: 12, shoulder_height: 12, num_flutes: 2,
    stepover_percent: 40, stock_to_leave: 0, depth_of_cut: 2, max_stepdown: 10, drive_geometry_position: "at_bottom",
    cut_feedrate: 800, plunge_feedrate: 250, lead_in_feedrate: 800, lead_out_feedrate: 800, departure_feedrate: 800, spindle_rpm: 18000, cut_direction: "climb",
    clearance_type: "stock_max_z_plus_offset", clearance_offset: 10, absolute_clearance_height: 25.4,
    operations_sorting: "selection", chordal_tolerance: 0.01,
  };
  if (type === "pocketing_2d") return { ...common, clearing_strategy: "offset", keep_tool_down: true };
  if (type === "profiling_2d") return { ...common, side: "outside" };
  if (type === "facing_2d") return { ...common, cut_direction: "mixed", direction_degrees: 0, edge_overtravel: 0 };
  return { ...common, direction_degrees: 0 };
}

function applyTool(tool: Tool) {
  if (!draft) return;
  Object.assign(draft.params, {
    tool_id: tool.id,
    tool_name: tool.name,
    tool_number: tool.toolNumber,
    tool_diameter: tool.diameter,
    cutting_height: tool.cuttingHeight,
    shoulder_height: tool.shoulderHeight,
    num_flutes: tool.numFlutes,
  });
}

async function loadTools() {
  if (!backendUrl) return;
  toolsLoading = true;
  render();
  try {
    const response = await fetch(`${backendUrl.replace(/\/$/, "")}/cam/tools`);
    tools = response.ok ? await response.json() as Tool[] : [];
    if (draft && tools.length > 0) {
      const selectedTool = tools.find((tool) => tool.id === draft?.params.tool_id)
        ?? tools.find((tool) => tool.name === draft?.params.tool_name && tool.toolNumber === draft?.params.tool_number)
        ?? tools[0];
      applyTool(selectedTool);
    }
  } catch {
    tools = [];
  } finally {
    toolsLoading = false;
    render();
  }
}

function operationIcon(type: string) {
  const template = document.querySelector<HTMLTemplateElement>(`#operation-icon-${type}`);
  const icon = template?.content.firstElementChild?.cloneNode(true) as SVGSVGElement | undefined;
  if (!icon) return undefined;
  icon.setAttribute("aria-hidden", "true");
  icon.style.width = "5rem";
  icon.style.height = "5rem";
  icon.style.transform = "translateY(0.75rem) scale(1.375)";
  icon.style.transformOrigin = "center bottom";
  return icon;
}

function field(text: string, control: HTMLElement) {
  const element = label(text, undefined, "xs");
  const isCheckbox = control.dataset.slot === "checkbox" || (control instanceof HTMLInputElement && control.type === "checkbox");
  element.style.width = "100%";
  element.style.gap = "0.25rem";
  if (isCheckbox) {
    element.style.flexDirection = "row";
    element.style.alignItems = "center";
  } else {
    element.style.flexDirection = "column";
    element.style.alignItems = "stretch";
  }
  if (!isCheckbox) {
    control.style.width = "100%";
    control.style.minWidth = "0";
    control.style.boxSizing = "border-box";
  }
  element.append(control);
  return element;
}

function paramInput(key: string, value: unknown, type = "text") {
  const control = input({ type, value: String(value ?? ""), size: "xs" });
  control.dataset.param = key;
  if (type === "checkbox") control.checked = Boolean(value);
  const update = () => {
    if (!draft) return;
    draft.params[key] = type === "checkbox" ? control.checked : type === "number" ? Number(control.value) || 0 : control.value;
  };
  control.addEventListener("input", update);
  control.addEventListener("change", update);
  return control;
}

function paramCheckbox(key: string, value: unknown) {
  return checkbox({ checked: Boolean(value), onChange: (checked) => { if (draft) draft.params[key] = checked; } });
}

function paramSelect(key: string, value: unknown, items: readonly { value: string; label: string }[]) {
  const control = select({ items, value: String(value ?? ""), size: "xs" });
  control.dataset.param = key;
  control.addEventListener("change", () => { if (draft) draft.params[key] = control.value; });
  return control;
}

function pageContent(value: Draft) {
  const params = value.params;
  const content = document.createElement("section");
  content.style.minWidth = "0";
  content.style.maxWidth = "100%";
  content.style.flex = "1 1 0";
  content.style.overflowX = "hidden";
  content.style.overflowY = "auto";
  content.style.padding = "0.5rem";
  content.style.display = "flex";
  content.style.flexDirection = "column";
  content.style.gap = "1rem";
  if (page === "geometry") {
    const geometry = document.createElement("div");
    geometry.style.display = "flex";
    geometry.style.flexDirection = "column";
    geometry.style.gap = "0.75rem";
    const tableFrame = document.createElement("div");
    tableFrame.style.border = "1px solid var(--border)";
    tableFrame.style.borderRadius = "calc(var(--radius) - 2px)";
    tableFrame.style.overflow = "hidden";
    const rows = value.regions.map((region, index) => {
      const sourceNames = Array.isArray(region.source_object_names)
        ? region.source_object_names.filter((name): name is string => typeof name === "string" && name.length > 0)
        : [];
      const sourceIds = Array.isArray(region.source_object_ids)
        ? region.source_object_ids.filter((id): id is string => typeof id === "string")
        : [];
      const origin = region.plane && typeof region.plane === "object"
        ? (region.plane as Record<string, unknown>).origin : undefined;
      const z = Array.isArray(origin) && typeof origin[2] === "number" ? origin[2].toFixed(3) : "—";
      const geometryName = sourceNames.length
        ? sourceNames.join(", ")
        : sourceIds.length ? `Edge loop (${sourceIds.length} source${sourceIds.length === 1 ? "" : "s"})` : `Edge loop ${index + 1}`;
      return {
        cells: [
          geometryName,
          z,
          button({ text: "Delete", variant: "destructive", size: "xs", onClick: () => { if (draft) { draft.regions.splice(index, 1); render(); } } }),
        ],
      };
    });
    tableFrame.append(table({
      columns: [{ label: "Geometry" }, { label: "Z coordinate" }, { label: "Action", align: "right" }],
      rows,
      empty: "No edge loops selected.",
    }));
    geometry.append(
      button({ text: "Add XY-planar edge loops", variant: "default", size: "xs", onClick: () => send({ action: "select_region", draft }) }),
      tableFrame,
    );
    content.append(geometry);
    return content;
  }
  if (page === "cut") {
    content.append(
      field("Stepover %", paramInput("stepover_percent", params.stepover_percent ?? 40, "number")),
      field("Cut direction", paramSelect("cut_direction", params.cut_direction, [
        { value: "climb", label: "Climb" }, { value: "conventional", label: "Conventional" },
        ...(value.type === "facing_2d" ? [{ value: "mixed", label: "Mixed" }] : []),
      ])),
    );
    if (value.type !== "facing_2d") content.append(
      field("Stock to leave", paramInput("stock_to_leave", params.stock_to_leave ?? 0, "number")),
    );
    if (value.type === "pocketing_2d") content.append(
      field("Clearing algorithm", paramSelect("clearing_strategy", params.clearing_strategy, [
        { value: "offset", label: "Offset" }, { value: "adaptive", label: "Adaptive" },
      ])),
      field("Keep tool down", paramCheckbox("keep_tool_down", params.keep_tool_down !== false)),
    );
    if (value.type === "profiling_2d") content.append(field("Side", paramSelect("side", params.side, [
      { value: "outside", label: "Outside" }, { value: "inside", label: "Inside" },
    ])));
    if (value.type === "facing_2d") content.append(
      field("Pass angle °", paramInput("direction_degrees", params.direction_degrees ?? 0, "number")),
      field("Edge overtravel", paramInput("edge_overtravel", params.edge_overtravel ?? 0, "number")),
    );
    if (value.type === "parallel_finishing") content.append(field("Slice direction °", paramInput("direction_degrees", params.direction_degrees ?? 0, "number")));
    return content;
  }
  if (page === "tool") {
    const selectedTool = tools.find((tool) => tool.id === params.tool_id)
      ?? tools.find((tool) => tool.name === params.tool_name && tool.toolNumber === params.tool_number);
    const picker = select({
      items: toolsLoading
        ? [{ value: "", label: "Loading tools…" }]
        : tools.length > 0
          ? tools.map((tool) => ({ value: tool.id, label: tool.name }))
          : [{ value: "", label: "No tools in library" }],
      value: selectedTool?.id ?? "",
      size: "xs",
    });
    picker.disabled = toolsLoading || tools.length === 0;
    picker.addEventListener("change", () => {
      const tool = tools.find((candidate) => candidate.id === picker.value);
      if (!tool) return;
      applyTool(tool);
      render();
    });
    content.append(field("Tool", picker));
    return content;
  }
  if (page === "feeds") {
    content.append(
      field("Spindle RPM", paramInput("spindle_rpm", params.spindle_rpm ?? 18000, "number")),
      field("Plunge feedrate", paramInput("plunge_feedrate", params.plunge_feedrate ?? 250, "number")),
      field("Lead-in feedrate", paramInput("lead_in_feedrate", params.lead_in_feedrate ?? 800, "number")),
      field("Cut feedrate", paramInput("cut_feedrate", params.cut_feedrate ?? 800, "number")),
      field("Lead-out feedrate", paramInput("lead_out_feedrate", params.lead_out_feedrate ?? 800, "number")),
      field("Departure feedrate", paramInput("departure_feedrate", params.departure_feedrate ?? 800, "number")),
    );
    return content;
  }
  if (page === "levels") {
    content.append(
      field("Drive geometry at", paramSelect("drive_geometry_position", params.drive_geometry_position, [
        { value: "at_bottom", label: "Bottom" }, { value: "at_top", label: "Top" },
      ])),
      field("Depth of cut", paramInput("depth_of_cut", params.depth_of_cut ?? 2, "number")),
      field("Max stepdown", paramInput("max_stepdown", params.max_stepdown ?? 10, "number")),
    );
    return content;
  }
  if (page === "clearance") {
    const clearanceType = String(params.clearance_type ?? "stock_max_z_plus_offset");
    const clearanceControl = paramSelect("clearance_type", clearanceType, [
      { value: "automatic", label: "Automatic" }, { value: "absolute", label: "Absolute" },
      { value: "stock_max_z_plus_offset", label: "Stock max Z + offset" },
      { value: "part_max_z_plus_offset", label: "Part max Z + offset" },
    ]);
    clearanceControl.addEventListener("change", render);
    content.append(field("Clearance height", clearanceControl));
    if (clearanceType === "absolute") content.append(field("Absolute height", paramInput("absolute_clearance_height", params.absolute_clearance_height ?? 25.4, "number")));
    if (clearanceType === "stock_max_z_plus_offset" || clearanceType === "part_max_z_plus_offset") content.append(field("Offset", paramInput("clearance_offset", params.clearance_offset ?? 10, "number")));
    return content;
  }
  content.append(
    field("Operation sorting", paramSelect("operations_sorting", params.operations_sorting, [
      { value: "selection", label: "Selection" }, { value: "shortest_distance", label: "Shortest distance" },
    ])),
    field("Chordal tolerance", paramInput("chordal_tolerance", params.chordal_tolerance ?? 0.01, "number")),
  );
  return content;
}

function dialogContent(main: HTMLElement, mode: "picker" | "editor") {
  main.dataset.slot = "dialog-content";
  main.style.display = "grid";
  main.style.gap = "0.5rem";
  main.style.width = "100%";
  main.style.margin = "0";
  main.style.background = "var(--background)";
  main.style.padding = "1rem";
  main.style.boxSizing = "border-box";
  main.style.minWidth = "0";
  main.style.overflow = "hidden";
  main.style.outline = "none";
  if (mode === "picker") {
    main.style.maxWidth = "36rem";
  } else {
    main.style.maxWidth = "64rem";
    main.style.height = "100%";
    main.style.maxHeight = "none";
    main.style.gridTemplateRows = "auto minmax(0, 1fr) auto";
  }
}

function dialogFooter() {
  const footer = document.createElement("footer");
  footer.dataset.slot = "dialog-footer";
  footer.style.display = "flex";
  footer.style.justifyContent = "flex-end";
  footer.style.gap = "0.5rem";
  return footer;
}

function render() {
  const main = document.createElement("main");
  root.style.height = "100%";
  if (!draft) {
    document.body.style.overflow = "hidden";
    root.style.display = "grid";
    root.style.placeItems = "center";
    root.style.padding = "0";
    dialogContent(main, "picker");
    const picker = document.createElement("div");
    picker.style.display = "grid";
    picker.style.gridTemplateColumns = "repeat(3, minmax(0, 1fr))";
    picker.style.gap = "0.75rem";
    picker.style.alignItems = "stretch";
    for (const [type, text] of Object.entries(labels)) {
      const choice = button({
        variant: "outline",
        size: "lg",
        onClick: () => send({ action: "begin", draft: { name: text, type, params: defaults(type), regions: [] } }),
      });
      choice.style.height = "auto";
      choice.style.flexDirection = "column";
      choice.style.justifyContent = "space-between";
      choice.style.gap = "0.75rem";
      choice.style.padding = "1rem";
      const iconFrame = document.createElement("div");
      iconFrame.style.display = "flex";
      iconFrame.style.width = "6.25rem";
      iconFrame.style.height = "6.25rem";
      iconFrame.style.alignItems = "flex-end";
      iconFrame.style.justifyContent = "center";
      iconFrame.style.flexShrink = "0";
      const icon = operationIcon(type);
      if (icon) iconFrame.append(icon);
      const textNode = document.createElement("span");
      textNode.style.textAlign = "center";
      textNode.textContent = text;
      choice.append(iconFrame, textNode);
      picker.append(choice);
    }
    const footer = dialogFooter();
    footer.append(button({ text: "Cancel", variant: "outline", size: "xs", onClick: () => send({ action: "cancel" }) }));
    main.append(picker, footer);
    root.replaceChildren(main);
    return;
  }

  document.body.style.overflow = "";
  root.style.display = "block";
  root.style.padding = "0";
  dialogContent(main, "editor");
  const header = document.createElement("header");
  header.dataset.slot = "dialog-header";
  header.style.display = "flex";
  header.style.flexDirection = "column";
  header.style.gap = "0.5rem";
  const name = input({ value: draft.name, size: "xs" });
  name.id = "name";
  name.addEventListener("input", () => { if (draft) draft.name = name.value; });
  header.append(field("Name", name));
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.width = "100%";
  body.style.minWidth = "0";
  body.style.minHeight = "0";
  body.style.overflow = "hidden";
  body.style.border = "1px solid var(--border)";
  body.style.borderRadius = "calc(var(--radius) - 2px)";
  const navigation = sidebar({
    items: pages,
    active: page,
    onChange: (id) => { page = id as Page; render(); },
  });
  navigation.element.style.background = "color-mix(in oklab, var(--muted) 30%, transparent)";
  body.append(navigation.element, pageContent(draft));
  const footer = dialogFooter();
  const generate = button({ text: "Generate", variant: "default", size: "xs", onClick: () => { if (draft?.regions.length) send({ action: "generate", draft }); } });
  generate.disabled = !draft.regions.length;
  footer.append(
    button({ text: "Cancel", variant: "outline", size: "xs", onClick: () => send({ action: "cancel" }) }),
    generate,
  );
  main.append(header, body, footer);
  root.replaceChildren(main);
}

host.opencamOperation = {
  theme: applyTheme,
  initialize(value) {
    draft = value.draft ? {
      ...value.draft,
      params: { ...defaults(value.draft.type), ...value.draft.params },
      regions: value.draft.regions ?? [],
    } : undefined;
    backendUrl = value.backend_url ?? "";
    tools = [];
    page = "geometry";
    render();
    void loadTools();
  },
};
render();
