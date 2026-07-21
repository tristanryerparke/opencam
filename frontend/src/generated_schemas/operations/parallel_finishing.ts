/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

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
}
/**
 * A reference to a mesh cached in the server mesh cache.
 */
export interface CachedMesh {
  source?: "cached";
  cacheId: string;
}
export interface ClosedPolyline25D {
  kind?: "closed_polyline";
  vertices: Point2D[];
  z: number;
}
export interface Point2D {
  x: number;
  y: number;
  [k: string]: unknown;
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
}
export interface ParallelFinishingCutSettings {
  /**
   * Lane travel direction in degrees from +X. Stepover advances 90 degrees CCW.
   */
  directionDegrees?: number;
  stepover?: StepoverMode;
  stockToLeave?: number;
}
export interface StepoverMode {
  mode?: "percentage_of_tool_diameter" | "absolute";
  value?: number;
}
export interface ParallelFinishingDriveGeometry {
  /**
   * @minItems 1
   */
  cutAreas: [ClosedPolyline25D, ...ClosedPolyline25D[]];
}
export interface ParallelFinishingOp {
  type?: "parallel_finishing";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  partMesh: Mesh | CachedMesh;
  driveGeometry: ParallelFinishingDriveGeometry;
  cutParameters?: ParallelFinishingCutSettings;
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
