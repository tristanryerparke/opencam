import { create } from "zustand";
import type { OcctReadResult } from "occt-import-js";
import { readStepFile } from "@/lib/occt";
import type { SelectedBrepEdgeLoop, SelectedBrepFace, StepSceneStats } from "@/lib/step-three";

export type LoadState = "idle" | "loading" | "ready" | "error";
export type PickMode = "none" | "face" | "edge-loop";

const READ_PARAMS = {
  linearUnit: "millimeter" as const,
  linearDeflectionType: "bounding_box_ratio" as const,
  linearDeflection: 0.001,
  angularDeflection: 0.5,
};

type StepViewerStore = {
  fileName: string | null;
  loadFile: (file: File) => Promise<void>;
  loadState: LoadState;
  message: string;
  pickMode: PickMode;
  result: OcctReadResult | null;
  selectedEdgeLoop: SelectedBrepEdgeLoop | null;
  selectedFace: SelectedBrepFace | null;
  stats: StepSceneStats | null;
  clearSelectedEdgeLoop: () => void;
  clearSelectedFace: () => void;
  selectEdgeLoop: (selection: SelectedBrepEdgeLoop) => void;
  selectFace: (selection: SelectedBrepFace) => void;
  setStats: (stats: StepSceneStats | null) => void;
  startEdgeLoopPicking: () => void;
  startFacePicking: () => void;
};

export const useStepViewerStore = create<StepViewerStore>((set) => ({
  fileName: null,
  loadState: "idle",
  message: "Upload a .step or .stp file to view it.",
  pickMode: "none",
  result: null,
  selectedEdgeLoop: null,
  selectedFace: null,
  stats: null,

  clearSelectedEdgeLoop: () => set({
    message: "Edge loop selection cleared.",
    pickMode: "none",
    selectedEdgeLoop: null,
  }),

  clearSelectedFace: () => set({
    message: "Face selection cleared.",
    pickMode: "none",
    selectedFace: null,
  }),

  loadFile: async (file) => {
    set({
      loadState: "loading",
      message: "Loading OpenCascade and reading STEP file…",
      pickMode: "none",
      selectedEdgeLoop: null,
      selectedFace: null,
      stats: null,
    });

    try {
      const result = await readStepFile(file, READ_PARAMS);
      set({
        fileName: file.name,
        loadState: "ready",
        message: "Loaded STEP faces and rendered BREP face-boundary edges as 1px LineSegments.",
        result,
      });
    } catch (error) {
      set({
        fileName: file.name,
        loadState: "error",
        message: error instanceof Error ? error.message : String(error),
        result: null,
      });
    }
  },

  selectEdgeLoop: (selection) => set({
    message: `Selected edge loop ${selection.loopIndex + 1}.`,
    pickMode: "none",
    selectedEdgeLoop: selection,
  }),

  selectFace: (selection) => set({
    message: `Selected BREP face ${selection.faceIndex + 1} on mesh ${selection.meshIndex + 1}.`,
    pickMode: "none",
    selectedFace: selection,
  }),

  setStats: (stats) => set({ stats }),

  startEdgeLoopPicking: () => set({
    message: "Move over an XY-planar edge loop, then click to pick it.",
    pickMode: "edge-loop",
  }),

  startFacePicking: () => set({ pickMode: "face" }),
}));
