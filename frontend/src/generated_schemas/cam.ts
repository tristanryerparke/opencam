/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface CAMSetup {
  partMesh?: (Mesh | CachedMesh) | null;
  clearanceOffset?: number;
  origin?: SetupOrigin;
  orientation?: SetupOrientation;
  stock?: SetupStock;
}
/**
 * Inline triangle-mesh part data.
 */
export interface Mesh {
  source?: "inline";
  /**
   * @minItems 3
   */
  vertices: [
    [unknown, unknown, unknown],
    [unknown, unknown, unknown],
    [unknown, unknown, unknown],
    ...[unknown, unknown, unknown][]
  ];
  /**
   * @minItems 1
   */
  faces: [[unknown, unknown, unknown], ...[unknown, unknown, unknown][]];
  sourceFaceIds?: number[] | null;
  [k: string]: unknown;
}
/**
 * A reference to a mesh cached in the server mesh cache.
 */
export interface CachedMesh {
  source?: "cached";
  cacheId: string;
  [k: string]: unknown;
}
export interface SetupOrigin {
  x?: number;
  y?: number;
  z?: number;
  [k: string]: unknown;
}
export interface SetupOrientation {
  /**
   * Current UI assumes a normally oriented setup with machine Z pointing up.
   */
  machineZAxis?: "positiveZ";
  [k: string]: unknown;
}
export interface SetupStock {
  /**
   * Used when clearance height is computed from stock height.
   */
  maxZ?: number;
  [k: string]: unknown;
}
export interface Facing2DOp {
  type?: "facing_2d";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AutomaticClearance | AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  /**
   * @minItems 1
   * @maxItems 1
   */
  driveGeometry: [ClosedPolyline25D];
  cutParameters?: FacingCutSettings;
}
export interface CylindricalTool {
  id?: string;
  name: string;
  toolNumber: number;
  manualChange?: boolean;
  diameter: number;
  cuttingHeight: number;
  shoulderHeight: number;
  numFlutes?: number;
  type?: "cylinder";
  [k: string]: unknown;
}
export interface BallTool {
  id?: string;
  name: string;
  toolNumber: number;
  manualChange?: boolean;
  diameter: number;
  cuttingHeight: number;
  shoulderHeight: number;
  numFlutes?: number;
  type?: "ball";
  [k: string]: unknown;
}
export interface VTool {
  id?: string;
  name: string;
  toolNumber: number;
  manualChange?: boolean;
  diameter: number;
  cuttingHeight: number;
  shoulderHeight: number;
  numFlutes?: number;
  type?: "v";
  tipAngle: number;
  [k: string]: unknown;
}
export interface FeedsAndSpeeds {
  spindleRpm?: number;
  plungeFeedrate?: number;
  leadInFeedrate?: number;
  cutFeedrate?: number;
  leadOutFeedrate?: number;
  departureFeedrate?: number;
  [k: string]: unknown;
}
export interface AutomaticClearance {
  clearanceHeightType?: "automatic";
  [k: string]: unknown;
}
export interface AbsoluteClearance {
  clearanceHeightType?: "absolute";
  absoluteHeight?: number;
  [k: string]: unknown;
}
export interface StockMaxZPlusOffsetClearance {
  clearanceHeightType?: "stock_max_z_plus_offset";
  offset?: number;
  [k: string]: unknown;
}
export interface PartMaxZPlusOffsetClearance {
  clearanceHeightType?: "part_max_z_plus_offset";
  offset?: number;
  [k: string]: unknown;
}
export interface CAMLevels {
  driveGeometryPosition?: "at_top" | "at_bottom";
  depthOfCut?: number;
  maxStepdown?: number;
  [k: string]: unknown;
}
export interface CAMAdvancedParameters {
  operationsSorting?: "selection" | "shortest_distance";
  chordalTolerance?: number;
  [k: string]: unknown;
}
export interface ClosedPolyline25D {
  kind?: "closed_polyline";
  vertices: Point2D[];
  z: number;
  [k: string]: unknown;
}
export interface Point2D {
  x: number;
  y: number;
  [k: string]: unknown;
}
export interface FacingCutSettings {
  cutDirection?: "climb" | "conventional" | "mixed";
  stepover?: StepoverMode;
  /**
   * Angle of cutting passes measured counterclockwise from the X axis.
   */
  directionDegrees?: number;
  /**
   * Additional cutter-center travel beyond each side and corner.
   */
  edgeOvertravel?: number;
  [k: string]: unknown;
}
export interface StepoverMode {
  mode?: "percentage_of_tool_diameter" | "absolute";
  value?: number;
  [k: string]: unknown;
}
export interface GenerateToolpathRequest {
  setup?: CAMSetup;
  operation: Pocketing2DOp | Profiling2DOp | Facing2DOp | ParallelFinishingOp;
}
export interface Pocketing2DOp {
  type?: "pocketing_2d";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AutomaticClearance | AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  /**
   * @minItems 1
   */
  driveGeometry: [ClosedPolyline25D, ...ClosedPolyline25D[]];
  cutParameters?: PocketingCutSettings;
}
export interface PocketingCutSettings {
  clearingStrategy?: "offset" | "adaptive";
  keepToolDown?: boolean;
  cutDirection?: "climb" | "conventional";
  stepover?: StepoverMode;
  stockToLeave?: number;
  [k: string]: unknown;
}
export interface Profiling2DOp {
  type?: "profiling_2d";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AutomaticClearance | AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  /**
   * @minItems 1
   */
  driveGeometry: [ClosedPolyline25D | Polyline25D, ...(ClosedPolyline25D | Polyline25D)[]];
  cutParameters?: ProfilingCutSettings;
}
export interface Polyline25D {
  kind?: "polyline";
  vertices: Point2D[];
  z: number;
  [k: string]: unknown;
}
export interface ProfilingCutSettings {
  side?: "outside" | "inside";
  cutDirection?: "climb" | "conventional";
  stockToLeave?: number;
  [k: string]: unknown;
}
export interface ParallelFinishingOp {
  type?: "parallel_finishing";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AutomaticClearance | AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  /**
   * @minItems 1
   */
  driveGeometry: [ClosedPolyline2D, ...ClosedPolyline2D[]];
  cutParameters?: ParallelFinishingCutSettings;
}
export interface ClosedPolyline2D {
  kind?: "closed_polyline";
  vertices: Point2D[];
  [k: string]: unknown;
}
export interface ParallelFinishingCutSettings {
  cutDirection?: "climb" | "conventional" | "mixed";
  /**
   * Pass orientation in degrees from +X. Stepover advances 90 degrees CCW.
   */
  directionDegrees?: number;
  stepover?: StepoverMode;
  stockToLeave?: number;
  [k: string]: unknown;
}
