/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface AbsoluteClearance {
  clearenceHeightType: "absolute";
  absoluteHeight: number;
}
export interface BaseCAMOperation {
  toolId: string;
  feedsAndSpeeds: ManualFeedsAndSpeedsSelection | ToolMaterialFeedsAndSpeedsSelection;
  clearence: StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance | AbsoluteClearance;
  levels: CAMLevels;
  advanced: CAMAdvancedParameters;
}
/**
 * Operation-specific manually entered feeds/speeds.
 */
export interface ManualFeedsAndSpeedsSelection {
  mode?: "manual";
  feedsAndSpeeds: FeedsAndSpeeds;
}
export interface FeedsAndSpeeds {
  spindleRpm: number;
  plungeFeedrate: number;
  leadInFeedrate: number;
  cutFeedrate: number;
  leadOutFeedrate: number;
  departureFeedrate: number;
}
/**
 * Operation feeds/speeds selected from the backend tool/material database.
 */
export interface ToolMaterialFeedsAndSpeedsSelection {
  mode?: "tool_material";
  materialId: string;
  toolMaterialFeedsAndSpeedsId: string;
}
export interface StockMaxZPlusOffsetClearance {
  clearenceHeightType: "stock_max_z_plus_offset";
  offset: number;
}
export interface PartMaxZPlusOffsetClearance {
  clearenceHeightType: "part_max_z_plus_offset";
  offset: number;
}
export interface CAMLevels {
  driveGeometryPosition: "at_top" | "at_bottom";
  depthOfCut: number;
  maxStepdown: number;
}
export interface CAMAdvancedParameters {
  operationsSorting: "selection" | "shortest_distance";
  chordalTolerance?: number;
}
export interface CAMSetup {
  origin?: Point3D;
  zAxis?: Vector3D;
  stock: MeshData | null;
  operations: BaseCAMOperation[];
}
export interface Point3D {
  x: number;
  y: number;
  z: number;
}
export interface Vector3D {
  x: number;
  y: number;
  z: number;
}
export interface MeshData {
  vertices: [unknown, unknown, unknown][];
  faces: [unknown, unknown, unknown][];
}
/**
 * The frontend uses camel case for its keys, this class handles
 * automatic serialization and deserialization to and from camel case
 */
export interface CamelBaseModel {}
export interface ClosedPolyline {
  vertices: Point2D[];
}
export interface Point2D {
  x: number;
  y: number;
}
/**
 * DB-backed material record.
 */
export interface Material {
  id?: string;
  name: string;
}
export interface PocketingCutSettings {
  cutDirection: "climb" | "conventional";
  stepover: StepoverMode;
  stockToLeave: number;
}
export interface StepoverMode {
  mode: "percentage_of_tool_diameter" | "absolute";
  value: number;
}
export interface PocketingDriveGeometry {
  cutAreas: ClosedPolyline[];
}
export interface PocketingOperation {
  toolId: string;
  feedsAndSpeeds: ManualFeedsAndSpeedsSelection | ToolMaterialFeedsAndSpeedsSelection;
  clearence: StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance | AbsoluteClearance;
  levels: CAMLevels;
  advanced: CAMAdvancedParameters;
  driveGeometry: PocketingDriveGeometry;
  cutParameters: PocketingCutSettings;
}
export interface Point3D1 {
  x: number;
  y: number;
  z: number;
}
/**
 * DB-backed tool record.
 */
export interface Tool {
  id?: string;
  diameter: number;
  fluteLength: number;
  shoulderLength: number;
  toolNumber: number | "manual";
}
/**
 * DB row for feeds/speeds for a specific tool cutting a specific material.
 */
export interface ToolMaterialFeedsAndSpeeds {
  id?: string;
  toolId: string;
  materialId: string;
  feedsAndSpeeds: FeedsAndSpeeds;
}
export interface Vector3D1 {
  x: number;
  y: number;
  z: number;
}
export interface ZContainment {
  zMin: number | null;
  zMax: number | null;
}
