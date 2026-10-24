import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "t-components/button";
import { OperationEditor, type ToolOption } from "opencam-react-ui/operation-dialog";
import {
  type DraftObject,
  type DraftValue,
  type JsonSchema,
  materializeDefaults,
  parseDraftValue,
  schemaValueToDraft,
} from "opencam-react-ui/operation-schema";
import { camSchemaBundle } from "opencam-react-ui/generated/cam.schemas";

type Region = Record<string, unknown>;
type Theme = { scheme: "light" | "dark"; tokens: Record<string, string> };
type LegacyDraft = { id?: string; name: string; type: OperationType; params: Record<string, unknown>; regions: Region[] };
type InitialValue = { draft?: LegacyDraft; backend_url?: string; has_part?: boolean };
type OperationType = "pocketing_2d" | "profiling_2d" | "facing_2d" | "parallel_finishing";
type HostWindow = Window & { eto?: { postMessage(value: string): void }; chrome?: { webview?: { postMessage(value: string): void } }; opencamOperation?: { initialize(value: InitialValue): void; theme(value: Theme): void } };

const host = window as HostWindow;
const schemas: Record<OperationType, JsonSchema> = {
  pocketing_2d: camSchemaBundle.pocket2dOperation as JsonSchema,
  profiling_2d: camSchemaBundle.profile2dOperation as JsonSchema,
  facing_2d: camSchemaBundle.facing2dOperation as JsonSchema,
  parallel_finishing: camSchemaBundle.parallelFinishingOperation as JsonSchema,
};
const labels: Record<OperationType, string> = {
  pocketing_2d: "2.5D Pocketing",
  profiling_2d: "2.5D Profiling",
  facing_2d: "2.5D Facing",
  parallel_finishing: "3D Parallel Finishing",
};

function send(value: Record<string, unknown>) {
  const json = JSON.stringify(value);
  if (host.eto) host.eto.postMessage(json);
  else host.chrome?.webview?.postMessage(json);
}

function operationSchema(type: OperationType) {
  return schemas[type];
}

function geometryFor(region: Region, type: OperationType): DraftObject[] {
  const plane = region.plane as { origin?: unknown } | undefined;
  const origin = Array.isArray(plane?.origin) ? plane.origin : [];
  const z = Number(origin[2]) || 0;
  const outerLoop = Array.isArray(region.outer_loop) ? region.outer_loop : [];
  const vertices = outerLoop.flatMap((point) => Array.isArray(point) && point.length >= 2
    ? [{ x: Number(point[0]), y: Number(point[1]) }]
    : []);
  if (!vertices.length) return [];
  return [type === "parallel_finishing" ? { vertices } : { kind: "closed_polyline", z, vertices }];
}

function toSchemaDraft(spec: LegacyDraft): DraftObject {
  const schema = operationSchema(spec.type);
  const params = spec.params;
  const geometry = spec.regions.flatMap((region) => geometryFor(region, spec.type));
  const tool = params.tool_id || params.tool_name ? {
    id: String(params.tool_id ?? ""), type: "cylinder", name: String(params.tool_name ?? "Flat end mill"), toolNumber: Number(params.tool_number ?? 1),
    diameter: Number(params.tool_diameter ?? 6), cuttingHeight: Number(params.cutting_height ?? 12), shoulderHeight: Number(params.shoulder_height ?? 12), numFlutes: Number(params.num_flutes ?? 2), manualChange: false,
  } : undefined;
  const clearanceType = String(params.clearance_type ?? "automatic");
  const clearance = clearanceType === "absolute"
    ? { clearanceHeightType: clearanceType, absoluteHeight: Number(params.absolute_clearance_height ?? 25.4) }
    : clearanceType === "automatic"
      ? { clearanceHeightType: clearanceType }
      : { clearanceHeightType: clearanceType, offset: Number(params.clearance_offset ?? 5) };
  const cutDirection = String(params.cut_direction ?? (spec.type === "facing_2d" || spec.type === "parallel_finishing" ? "mixed" : "climb"));
  const cutParameters: DraftObject = spec.type === "pocketing_2d"
    ? { clearingStrategy: String(params.clearing_strategy ?? "offset"), keepToolDown: params.keep_tool_down !== false, cutDirection, stepover: { mode: "percentage_of_tool_diameter", value: Number(params.stepover_percent ?? 25) }, stockToLeave: Number(params.stock_to_leave ?? 0) }
    : spec.type === "profiling_2d"
      ? { side: String(params.side ?? "outside"), cutDirection, stockToLeave: Number(params.stock_to_leave ?? 0) }
      : spec.type === "facing_2d"
        ? { cutDirection, stepover: { mode: "percentage_of_tool_diameter", value: Number(params.stepover_percent ?? 25) }, directionDegrees: Number(params.direction_degrees ?? 0), edgeOvertravel: Number(params.edge_overtravel ?? 0) }
        : { cutDirection, directionDegrees: Number(params.direction_degrees ?? 0), stepover: { mode: "percentage_of_tool_diameter", value: Number(params.stepover_percent ?? 25) }, stockToLeave: Number(params.stock_to_leave ?? 0) };
  return schemaValueToDraft(schema, {
    ...(materializeDefaults(schema, schema) as DraftObject),
    id: spec.id ?? crypto.randomUUID(), type: spec.type, displayName: spec.name, tool, driveGeometry: geometry,
    feedsAndSpeeds: { spindleRpm: Number(params.spindle_rpm ?? 12000), plungeFeedrate: Number(params.plunge_feedrate ?? 250), leadInFeedrate: Number(params.lead_in_feedrate ?? 500), cutFeedrate: Number(params.cut_feedrate ?? 500), leadOutFeedrate: Number(params.lead_out_feedrate ?? 500), departureFeedrate: Number(params.departure_feedrate ?? 500) },
    clearance,
    levels: { driveGeometryPosition: String(params.drive_geometry_position ?? "at_bottom"), depthOfCut: Number(params.depth_of_cut ?? 5), maxStepdown: Number(params.max_stepdown ?? 20) },
    advanced: { operationsSorting: String(params.operations_sorting ?? "shortest_distance"), chordalTolerance: Number(params.chordal_tolerance ?? 0.01) },
    cutParameters,
  }, schema) as DraftObject;
}

function objectValue(value: DraftValue | undefined): DraftObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as DraftObject : {};
}

function toLegacyDraft(source: LegacyDraft, draft: DraftObject, validate = true): LegacyDraft {
  const parsed = (validate
    ? parseDraftValue(operationSchema(source.type), draft, operationSchema(source.type), "Operation")
    : draft) as DraftObject;
  const tool = objectValue(parsed.tool);
  const feeds = objectValue(parsed.feedsAndSpeeds);
  const clearance = objectValue(parsed.clearance);
  const levels = objectValue(parsed.levels);
  const advanced = objectValue(parsed.advanced);
  const cut = objectValue(parsed.cutParameters);
  const stepover = objectValue(cut.stepover);
  const params: Record<string, unknown> = {
    tool_id: tool.id, tool_name: tool.name, tool_number: tool.toolNumber, tool_diameter: tool.diameter, cutting_height: tool.cuttingHeight, shoulder_height: tool.shoulderHeight, num_flutes: tool.numFlutes,
    spindle_rpm: feeds.spindleRpm, plunge_feedrate: feeds.plungeFeedrate, lead_in_feedrate: feeds.leadInFeedrate, cut_feedrate: feeds.cutFeedrate, lead_out_feedrate: feeds.leadOutFeedrate, departure_feedrate: feeds.departureFeedrate,
    clearance_type: clearance.clearanceHeightType, clearance_offset: clearance.offset, absolute_clearance_height: clearance.absoluteHeight,
    drive_geometry_position: levels.driveGeometryPosition, depth_of_cut: levels.depthOfCut, max_stepdown: levels.maxStepdown,
    operations_sorting: advanced.operationsSorting, chordal_tolerance: advanced.chordalTolerance,
    cut_direction: cut.cutDirection, stepover_percent: stepover.value, stock_to_leave: cut.stockToLeave,
    clearing_strategy: cut.clearingStrategy, keep_tool_down: cut.keepToolDown, side: cut.side,
    direction_degrees: cut.directionDegrees, edge_overtravel: cut.edgeOvertravel,
  };
  return { ...source, name: String(parsed.displayName ?? source.name), params, regions: source.regions.slice(0, Array.isArray(parsed.driveGeometry) ? parsed.driveGeometry.length : 0) };
}

function OperationPickerIcon({ type }: { type: OperationType }) {
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const icon = document.querySelector<HTMLTemplateElement>(`#operation-icon-${type}`)?.content.firstElementChild?.cloneNode(true) as SVGSVGElement | undefined;
    if (!icon || !frame.current) return;
    icon.setAttribute("aria-hidden", "true");
    icon.style.width = "5rem";
    icon.style.height = "5rem";
    icon.style.transform = "translateY(0.75rem) scale(1.375)";
    icon.style.transformOrigin = "center bottom";
    frame.current.replaceChildren(icon);
  }, [type]);

  return <div ref={frame} style={{ display: "flex", width: "6.25rem", height: "6.25rem", flexShrink: 0, alignItems: "flex-end", justifyContent: "center" }} />;
}

function OperationPicker({ onSelect }: { onSelect: (type: OperationType) => void }) {
  return <main style={{ margin: "auto", display: "flex", flexDirection: "column", gap: "0.5rem", width: "100%", maxWidth: "26.75rem", maxHeight: "100%", overflowY: "auto", padding: "1rem" }}>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 11rem)", justifyContent: "center", gap: "0.75rem" }}>
      {(Object.keys(labels) as OperationType[]).map((type) => (
        <Button key={type} variant="outline" size="lg" style={{ width: "11rem", height: "11rem", flexDirection: "column", justifyContent: "space-between", gap: "0.75rem", padding: "1rem", whiteSpace: "normal" }} onClick={() => onSelect(type)}>
          <OperationPickerIcon type={type} />
          <span style={{ textAlign: "center" }}>{labels[type]}</span>
        </Button>
      ))}
    </div>
    <footer style={{ display: "flex", justifyContent: "flex-end" }}><Button variant="outline" onClick={() => send({ action: "cancel" })}>Cancel</Button></footer>
  </main>;
}

function RhinoOperationDialog({ initial }: { initial: InitialValue }) {
  const [source] = useState<LegacyDraft | undefined>(initial.draft);
  const [draft, setDraft] = useState<DraftObject | null>(() => initial.draft ? toSchemaDraft(initial.draft) : null);
  const schema = source ? operationSchema(source.type) : null;
  const loadTools = useCallback(async (): Promise<readonly ToolOption[]> => {
    if (!initial.backend_url) return [];
    const response = await fetch(`${initial.backend_url.replace(/\/$/, "")}/cam/tools`);
    if (!response.ok) throw new Error("Unable to load tools.");
    const tools = await response.json() as Array<Record<string, unknown>>;
    return tools.map((tool) => ({ id: String(tool.id), name: String(tool.name), value: tool as unknown as DraftObject }));
  }, [initial.backend_url]);
  const selectType = (type: OperationType) => {
    send({ action: "begin", draft: { name: labels[type], type, params: {}, regions: [] } });
  };
  if (!source || !draft || !schema) return <OperationPicker onSelect={selectType} />;
  const validationMessage = (() => {
    try {
      parseDraftValue(schema, draft, schema, "Operation");
      if (source.type === "parallel_finishing" && !initial.has_part)
        return "Select a part before generating this operation.";
      if (source.type !== "parallel_finishing" && toLegacyDraft(source, draft).regions.length === 0)
        return "Select drive geometry before generating this operation.";
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Operation is invalid.";
    }
  })();

  return (
    <main style={{ display: "grid", gridTemplateRows: "minmax(0, 1fr) auto", height: "100%", minHeight: 0, gap: "0.75rem", padding: "0.75rem" }}>
      <OperationEditor
        draft={draft}
        mode={initial.draft ? "edit" : "create"}
        rootSchema={schema}
        loadTools={loadTools}
        onDraftChange={setDraft}
        onStartGeometrySelection={() => send({ action: "select_region", draft: toLegacyDraft(source, draft, false) })}
      />
      <footer style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
        <Button type="button" variant="outline" onClick={() => send({ action: "cancel" })}>Cancel</Button>
        <Button type="button" disabled={validationMessage !== null} onClick={() => send({ action: "generate", draft: toLegacyDraft(source, draft) })}>Generate</Button>
      </footer>
    </main>
  );
}

const element = document.querySelector<HTMLElement>("#app");
if (!element) throw new Error("OpenCAM operation dialog root is missing.");
const root = createRoot(element);
function render(initial: InitialValue = {}) { root.render(<RhinoOperationDialog key={JSON.stringify(initial.draft ?? null)} initial={initial} />); }
host.opencamOperation = { initialize: render, theme(theme) { document.documentElement.classList.toggle("dark", theme.scheme === "dark"); document.documentElement.style.colorScheme = theme.scheme; } };
render();
