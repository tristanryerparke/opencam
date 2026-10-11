/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface ArcPositionRecord3D {
  type?: "position_3d";
  x: number;
  y: number;
  z: number;
  comment?: string | null;
  motionRole?: "cutting" | "linking";
  feedType?: "arc";
  centerOffsetX: number;
  centerOffsetY: number;
  clockwise: boolean;
  feedrate: number;
}
export interface FeedRatePositionRecord3D {
  type?: "position_3d";
  x: number;
  y: number;
  z: number;
  comment?: string | null;
  motionRole?: "cutting" | "linking";
  feedType?: "feed_rate";
  feedrate: number;
}
/**
 * Holds a set of positional data as well as tool, comment and data
 */
export interface OperationRecord3D {
  tool: CylindricalTool | BallTool | VTool;
  toolAxis?: number[];
  preComments?: string[];
  postComments?: string[];
  spindleRpm?: number;
  clearancePlaneHeight: number;
  records: (RapidPositionRecord3D | FeedRatePositionRecord3D | ArcPositionRecord3D)[];
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
export interface RapidPositionRecord3D {
  type?: "position_3d";
  x: number;
  y: number;
  z: number;
  comment?: string | null;
  motionRole?: "travel";
  feedType?: "rapid";
}
/**
 * Three-axis position data for translation into G-code by a post processor.
 */
export interface PositionRecord3D {
  type?: "position_3d";
  x: number;
  y: number;
  z: number;
  comment?: string | null;
  motionRole?: "cutting" | "linking" | "travel";
}
