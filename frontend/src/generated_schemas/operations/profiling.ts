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
export interface Polyline25D {
  kind?: "polyline";
  vertices: Point2D[];
  z: number;
}
export interface Profiling2DOp {
  type?: "profiling_2d";
  id?: string;
  displayName?: string;
  tool: CylindricalTool | BallTool | VTool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
  levels?: CAMLevels;
  advanced?: CAMAdvancedParameters;
  driveGeometry: ProfilingDriveGeometry;
  cutParameters?: ProfilingCutSettings;
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
export interface ProfilingDriveGeometry {
  /**
   * @minItems 1
   */
  profiles: [ClosedPolyline25D | Polyline25D, ...(ClosedPolyline25D | Polyline25D)[]];
}
export interface ProfilingCutSettings {
  side?: "outside" | "inside";
  cutDirection?: "climb" | "conventional";
  stockToLeave?: number;
}
