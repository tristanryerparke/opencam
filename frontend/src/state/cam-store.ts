import { create } from "zustand";
import type { SetStateAction } from "react";

import type { DraftObject, Operation } from "@/lib/cam-schema";
import type { MeshFaceSelection } from "@/components/polyline-viewer/types";
import type { OperationRecord3D } from "@/simulation/toolpath";

type GeneratedOperationResponse = OperationRecord3D;

type DialogMode = "create" | "edit";

type CamStore = {
  workspace: {
    meshName: string | null;
    meshUrl: string | null;
    meshMaxZ: number | null;
    cachedMeshVersion: string | null;
    operations: Operation[];
    generatedOperationsById: Record<string, GeneratedOperationResponse>;
  };
  selection: {
    selectedMeshFace: MeshFaceSelection | null;
    faceSelectionMode: boolean;
    selectedOperationId: string | null;
    selectedTreeNodeId: string;
  };
  dialogs: {
    isOperationTypeDialogOpen: boolean;
    isOperationDialogOpen: boolean;
    operationDialogMode: DialogMode;
    resumeOperationDialogAfterSelection: boolean;
    operationDraft: DraftObject | null;
  };
  viewport: {
    isSimulationMode: boolean;
    isComparisonMode: boolean;
    showStock: boolean;
    showPartMesh: boolean;
    showToolpaths: boolean;
    showTool: boolean;
  };
  simulation: {
    id: string | null;
    frameCount: number;
    frameIndex: number;
    stride: number;
    displayedFrameIndex: number | null;
    isPlaying: boolean;
  };
  actions: {
    setMeshName: (value: SetStateAction<string | null>) => void;
    setMeshUrl: (value: SetStateAction<string | null>) => void;
    setMeshMaxZ: (value: SetStateAction<number | null>) => void;
    setCachedMeshVersion: (value: SetStateAction<string | null>) => void;
    setOperations: (value: SetStateAction<Operation[]>) => void;
    setGeneratedOperationsById: (value: SetStateAction<Record<string, GeneratedOperationResponse>>) => void;
    selectTreeNode: (nodeId: string) => void;
    setSelectedMeshFace: (value: SetStateAction<MeshFaceSelection | null>) => void;
    setFaceSelectionMode: (value: SetStateAction<boolean>) => void;
    setSelectedOperationId: (value: SetStateAction<string | null>) => void;
    setSelectedTreeNodeId: (value: SetStateAction<string>) => void;
    setIsOperationTypeDialogOpen: (value: SetStateAction<boolean>) => void;
    setIsOperationDialogOpen: (value: SetStateAction<boolean>) => void;
    setOperationDialogMode: (value: SetStateAction<DialogMode>) => void;
    setResumeOperationDialogAfterSelection: (value: SetStateAction<boolean>) => void;
    setOperationDraft: (value: SetStateAction<DraftObject | null>) => void;
    setIsSimulationMode: (value: SetStateAction<boolean>) => void;
    setIsComparisonMode: (value: SetStateAction<boolean>) => void;
    setShowStock: (value: SetStateAction<boolean>) => void;
    setShowPartMesh: (value: SetStateAction<boolean>) => void;
    setShowToolpaths: (value: SetStateAction<boolean>) => void;
    setShowTool: (value: SetStateAction<boolean>) => void;
    setSimulationId: (value: SetStateAction<string | null>) => void;
    setSimulationFrameCount: (value: SetStateAction<number>) => void;
    setSimulationFrameIndex: (value: SetStateAction<number>) => void;
    setSimulationStride: (value: SetStateAction<number>) => void;
    setDisplayedSimulationFrameIndex: (value: SetStateAction<number | null>) => void;
    setIsSimulationPlaying: (value: SetStateAction<boolean>) => void;
  };
};

function resolveValue<T>(value: SetStateAction<T>, current: T) {
  return typeof value === "function"
    ? (value as (previous: T) => T)(current)
    : value;
}

export const useCamStore = create<CamStore>((set) => ({
  workspace: {
    meshName: null,
    meshUrl: null,
    meshMaxZ: null,
    cachedMeshVersion: null,
    operations: [],
    generatedOperationsById: {},
  },
  selection: {
    selectedMeshFace: null,
    faceSelectionMode: false,
    selectedOperationId: null,
    selectedTreeNodeId: "setup-1",
  },
  dialogs: {
    isOperationTypeDialogOpen: false,
    isOperationDialogOpen: false,
    operationDialogMode: "create",
    resumeOperationDialogAfterSelection: false,
    operationDraft: null,
  },
  viewport: {
    isSimulationMode: false,
    isComparisonMode: false,
    showStock: false,
    showPartMesh: true,
    showToolpaths: true,
    showTool: true,
  },
  simulation: {
    id: null,
    frameCount: 0,
    frameIndex: 0,
    stride: 1,
    displayedFrameIndex: null,
    isPlaying: false,
  },
  actions: {
    setMeshName: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        meshName: resolveValue(value, state.workspace.meshName),
      },
    })),
    setMeshUrl: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        meshUrl: resolveValue(value, state.workspace.meshUrl),
      },
    })),
    setMeshMaxZ: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        meshMaxZ: resolveValue(value, state.workspace.meshMaxZ),
      },
    })),
    setCachedMeshVersion: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        cachedMeshVersion: resolveValue(value, state.workspace.cachedMeshVersion),
      },
    })),
    setOperations: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        operations: resolveValue(value, state.workspace.operations),
      },
    })),
    setGeneratedOperationsById: (value) => set((state) => ({
      workspace: {
        ...state.workspace,
        generatedOperationsById: resolveValue(value, state.workspace.generatedOperationsById),
      },
    })),
    selectTreeNode: (nodeId) => set((state) => ({
      selection: {
        ...state.selection,
        selectedTreeNodeId: nodeId,
        selectedOperationId: nodeId === "setup-1" || nodeId === "part" ? null : nodeId,
      },
    })),
    setSelectedMeshFace: (value) => set((state) => ({
      selection: {
        ...state.selection,
        selectedMeshFace: resolveValue(value, state.selection.selectedMeshFace),
      },
    })),
    setFaceSelectionMode: (value) => set((state) => ({
      selection: {
        ...state.selection,
        faceSelectionMode: resolveValue(value, state.selection.faceSelectionMode),
      },
    })),
    setSelectedOperationId: (value) => set((state) => ({
      selection: {
        ...state.selection,
        selectedOperationId: resolveValue(value, state.selection.selectedOperationId),
      },
    })),
    setSelectedTreeNodeId: (value) => set((state) => ({
      selection: {
        ...state.selection,
        selectedTreeNodeId: resolveValue(value, state.selection.selectedTreeNodeId),
      },
    })),
    setIsOperationTypeDialogOpen: (value) => set((state) => ({
      dialogs: {
        ...state.dialogs,
        isOperationTypeDialogOpen: resolveValue(value, state.dialogs.isOperationTypeDialogOpen),
      },
    })),
    setIsOperationDialogOpen: (value) => set((state) => ({
      dialogs: {
        ...state.dialogs,
        isOperationDialogOpen: resolveValue(value, state.dialogs.isOperationDialogOpen),
      },
    })),
    setOperationDialogMode: (value) => set((state) => ({
      dialogs: {
        ...state.dialogs,
        operationDialogMode: resolveValue(value, state.dialogs.operationDialogMode),
      },
    })),
    setResumeOperationDialogAfterSelection: (value) => set((state) => ({
      dialogs: {
        ...state.dialogs,
        resumeOperationDialogAfterSelection: resolveValue(value, state.dialogs.resumeOperationDialogAfterSelection),
      },
    })),
    setOperationDraft: (value) => set((state) => ({
      dialogs: {
        ...state.dialogs,
        operationDraft: resolveValue(value, state.dialogs.operationDraft),
      },
    })),
    setIsSimulationMode: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        isSimulationMode: resolveValue(value, state.viewport.isSimulationMode),
      },
    })),
    setIsComparisonMode: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        isComparisonMode: resolveValue(value, state.viewport.isComparisonMode),
      },
    })),
    setShowStock: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        showStock: resolveValue(value, state.viewport.showStock),
      },
    })),
    setShowPartMesh: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        showPartMesh: resolveValue(value, state.viewport.showPartMesh),
      },
    })),
    setShowToolpaths: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        showToolpaths: resolveValue(value, state.viewport.showToolpaths),
      },
    })),
    setShowTool: (value) => set((state) => ({
      viewport: {
        ...state.viewport,
        showTool: resolveValue(value, state.viewport.showTool),
      },
    })),
    setSimulationId: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        id: resolveValue(value, state.simulation.id),
      },
    })),
    setSimulationFrameCount: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        frameCount: resolveValue(value, state.simulation.frameCount),
      },
    })),
    setSimulationFrameIndex: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        frameIndex: resolveValue(value, state.simulation.frameIndex),
      },
    })),
    setSimulationStride: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        stride: resolveValue(value, state.simulation.stride),
      },
    })),
    setDisplayedSimulationFrameIndex: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        displayedFrameIndex: resolveValue(value, state.simulation.displayedFrameIndex),
      },
    })),
    setIsSimulationPlaying: (value) => set((state) => ({
      simulation: {
        ...state.simulation,
        isPlaying: resolveValue(value, state.simulation.isPlaying),
      },
    })),
  },
}));

export type { CamStore };
