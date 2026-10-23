import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light" | "system";
export type ToolRenderMode = "wireframe" | "shaded";

type SettingsStore = {
  theme: Theme;
  toolRenderMode: ToolRenderMode;
  partRenderMode: ToolRenderMode;
  stockRenderMode: ToolRenderMode;
  clearanceOffset: number;
  simulationDebugUiEnabled: boolean;
  simulationCompletedToolpathOnly: boolean;
  setTheme: (theme: Theme) => void;
  setToolRenderMode: (mode: ToolRenderMode) => void;
  setPartRenderMode: (mode: ToolRenderMode) => void;
  setStockRenderMode: (mode: ToolRenderMode) => void;
  setClearanceOffset: (offset: number) => void;
  setSimulationDebugUiEnabled: (enabled: boolean) => void;
  setSimulationCompletedToolpathOnly: (enabled: boolean) => void;
};

function applyTheme(theme: Theme) {
  if (typeof window === "undefined") {
    return;
  }

  const root = window.document.documentElement;
  root.classList.remove("light", "dark");

  if (theme === "system") {
    root.classList.add(
      window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    );
  } else {
    root.classList.add(theme);
  }
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: "system",
      toolRenderMode: "wireframe",
      partRenderMode: "shaded",
      stockRenderMode: "shaded",
      clearanceOffset: 10,
      simulationDebugUiEnabled: false,
      simulationCompletedToolpathOnly: true,
      setTheme: (theme) => set({ theme }),
      setToolRenderMode: (toolRenderMode) => set({ toolRenderMode }),
      setPartRenderMode: (partRenderMode) => set({ partRenderMode }),
      setStockRenderMode: (stockRenderMode) => set({ stockRenderMode }),
      setClearanceOffset: (clearanceOffset) => set({ clearanceOffset }),
      setSimulationDebugUiEnabled: (simulationDebugUiEnabled) => set({ simulationDebugUiEnabled }),
      setSimulationCompletedToolpathOnly: (simulationCompletedToolpathOnly) => set({ simulationCompletedToolpathOnly }),
    }),
    {
      name: "opencam.settings.v1",
      onRehydrateStorage: () => (state) => {
        if (state) {
          applyTheme(state.theme);
        }
      },
    },
  ),
);

useSettingsStore.subscribe((state) => applyTheme(state.theme));
applyTheme(useSettingsStore.getState().theme);
