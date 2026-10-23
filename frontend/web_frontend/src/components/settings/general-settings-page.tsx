import { Monitor, Moon, Sun } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "t-components/select";
import { Tabs, TabsList, TabsTrigger } from "t-components/tabs";
import { useSettingsStore, type Theme, type ToolRenderMode } from "@/state/settings-store";

const themeModes = ["system", "light", "dark"] as const;

const themeModeConfig = {
  system: { icon: Monitor, label: "System" },
  light: { icon: Sun, label: "Light" },
  dark: { icon: Moon, label: "Dark" },
} satisfies Record<Theme, { icon: typeof Monitor; label: string }>;

function ThemeSelect() {
  const { theme, setTheme } = useSettingsStore();

  return (
    <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
      <SelectTrigger className="w-36">
        <SelectValue placeholder="Select theme" />
      </SelectTrigger>
      <SelectContent>
        {themeModes.map((mode) => {
          const Icon = themeModeConfig[mode].icon;
          return (
            <SelectItem key={mode} value={mode}>
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                <span>{themeModeConfig[mode].label}</span>
              </div>
            </SelectItem>
          );
        })}
      </SelectContent>
    </Select>
  );
}

function RenderModeTabs({
  value,
  onChange,
  ariaLabel,
}: {
  value: ToolRenderMode;
  onChange: (mode: ToolRenderMode) => void;
  ariaLabel: string;
}) {
  return (
    <Tabs aria-label={ariaLabel} value={value} onValueChange={(next) => onChange(next as ToolRenderMode)}>
      <TabsList>
        <TabsTrigger value="wireframe">Wireframe</TabsTrigger>
        <TabsTrigger value="shaded">Shaded</TabsTrigger>
      </TabsList>
    </Tabs>
  );
}

export function GeneralSettingsPage() {
  const {
    simulationDebugUiEnabled,
    toolRenderMode,
    partRenderMode,
    stockRenderMode,
    clearanceOffset,
    simulationCompletedToolpathOnly,
    setSimulationDebugUiEnabled,
    setSimulationCompletedToolpathOnly,
    setToolRenderMode,
    setPartRenderMode,
    setStockRenderMode,
    setClearanceOffset,
  } = useSettingsStore();

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Theme</div>
          <p className="text-xs text-muted-foreground">Choose light, dark, or follow the system preference.</p>
        </div>
        <ThemeSelect />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Tool render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded tool previews.</p>
        </div>
        <RenderModeTabs value={toolRenderMode} onChange={setToolRenderMode} ariaLabel="Tool render mode" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Part render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded part meshes.</p>
        </div>
        <RenderModeTabs value={partRenderMode} onChange={setPartRenderMode} ariaLabel="Part render mode" />
      </div>

      <div className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Stock render</div>
          <p className="text-xs text-muted-foreground">Switch between wireframe and shaded stock meshes.</p>
        </div>
        <RenderModeTabs value={stockRenderMode} onChange={setStockRenderMode} ariaLabel="Stock render mode" />
      </div>

      <label className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Automatic clearance offset</div>
          <p className="text-xs text-muted-foreground">Added above the highest part, stock, or operation Z.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.1"
            value={clearanceOffset}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (Number.isFinite(next) && next >= 0) {
                setClearanceOffset(next);
              }
            }}
            className="w-24 rounded-md border bg-background px-2 py-1 text-right text-sm"
            aria-label="Automatic clearance offset in millimeters"
          />
          <span className="text-sm text-muted-foreground">mm</span>
        </div>
      </label>

      <label className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Completed toolpath only</div>
          <p className="text-xs text-muted-foreground">During simulation, show only the toolpath already cut, animated per simulation frame.</p>
        </div>
        <input
          type="checkbox"
          checked={simulationCompletedToolpathOnly}
          onChange={(event) => setSimulationCompletedToolpathOnly(event.target.checked)}
        />
      </label>

      <label className="flex items-center justify-between gap-4 rounded-md border p-2">
        <div>
          <div className="text-sm font-medium">Simulation debug UI</div>
          <p className="text-xs text-muted-foreground">Show chunk stats and debug colors in the viewport.</p>
        </div>
        <input
          type="checkbox"
          checked={simulationDebugUiEnabled}
          onChange={(event) => setSimulationDebugUiEnabled(event.target.checked)}
        />
      </label>
    </div>
  );
}
