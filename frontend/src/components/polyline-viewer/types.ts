import { type FeedType, type SimulationSamplePoint, type ToolData } from "@/simulation/toolpath";

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

export type PolylineViewerProps = {
  meshUrl?: string | null;
  secondaryMeshUrl?: string | null;
  meshColor?: number;
  meshOpacity?: number;
  meshUseVertexColors?: boolean;
  meshEdgeColor?: number | null;
  secondaryMeshColor?: number;
  secondaryMeshOpacity?: number;
  secondaryMeshUseVertexColors?: boolean;
  secondaryMeshEdgeColor?: number | null;
  polylines: ReadonlyArray<PolylineDefinition>;
  className?: string;
  faceSelectionMode?: boolean;
  selectedMeshFace?: MeshFaceSelection | null;
  selectedMeshFaces?: ReadonlyArray<MeshFaceSelection>;
  simulationTool?: ToolData | null;
  simulationSamples?: ReadonlyArray<SimulationSamplePoint>;
  simulationStep?: number;
  simulationToolMeshUrl?: string | null;
  simulationToolPosition?: PolylinePoint | null;
  simulationToolRotation?: number | null;
  simulationToolRotationEnabled?: boolean;
  showOriginalMesh?: boolean;
  onMeshFaceSelect?: (selection: MeshFaceSelection) => void;
};

export type PolylineViewerSceneProps = Omit<PolylineViewerProps, "className">;
