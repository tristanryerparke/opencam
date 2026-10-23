import { type FeedType, type SimulationSamplePoint } from "@/simulation/toolpath";

export type PolylinePoint = readonly [number, number, number];

export type PolylineDefinition = {
  id: string;
  name: string;
  points: ReadonlyArray<PolylinePoint>;
  color?: string;
  kind?: FeedType;
};

export type MeshFaceSelection = {
  id: string;
  label: string;
  normal: [number, number, number];
  triangleIndices: number[];
  triangleCount: number;
  area: number;
  isParallelToXY: boolean;
  planeZ: number | null;
  boundaryLoop: ReadonlyArray<PolylinePoint> | null;
  validationError: string | null;
};

export type ToolRenderMode = "wireframe" | "shaded";

export type PolylineViewerProps = {
  meshUrl?: string | null;
  secondaryMeshUrl?: string | null;
  tertiaryMeshUrl?: string | null;
  meshColor?: number;
  meshOpacity?: number;
  meshUseVertexColors?: boolean;
  meshEdgeColor?: number | null;
  secondaryMeshColor?: number;
  secondaryMeshOpacity?: number;
  secondaryMeshUseVertexColors?: boolean;
  secondaryMeshEdgeColor?: number | null;
  tertiaryMeshColor?: number;
  tertiaryMeshOpacity?: number;
  tertiaryMeshUseVertexColors?: boolean;
  tertiaryMeshEdgeColor?: number | null;
  showMesh?: boolean;
  showSecondaryMesh?: boolean;
  showTertiaryMesh?: boolean;
  showSimulationStock?: boolean;
  showTool?: boolean;
  toolRenderMode?: ToolRenderMode;
  partRenderMode?: ToolRenderMode;
  stockRenderMode?: ToolRenderMode;
  polylines: ReadonlyArray<PolylineDefinition>;
  className?: string;
  faceSelectionMode?: boolean;
  selectedMeshFace?: MeshFaceSelection | null;
  selectedMeshFaces?: ReadonlyArray<MeshFaceSelection>;
  simulationSamples?: ReadonlyArray<SimulationSamplePoint>;
  simulationStep?: number;
  simulationToolMeshUrl?: string | null;
  simulationToolPosition?: PolylinePoint | null;
  showOriginalMesh?: boolean;
  onMeshFaceSelect?: (selection: MeshFaceSelection) => void;
  onSecondaryMeshDisplayed?: (meshUrl: string, elapsedMs: number) => void;
  onSecondaryMeshLoadFailed?: (meshUrl: string, error: unknown) => void;
  onTertiaryMeshDisplayed?: (meshUrl: string, elapsedMs: number) => void;
  onTertiaryMeshLoadFailed?: (meshUrl: string, error: unknown) => void;
};

export type PolylineViewerSceneProps = Omit<PolylineViewerProps, "className">;
