/**
 * This file is auto-generated from Python Pydantic models.
 * Do not edit it by hand.
 */

export type OriginX = number;
export type OriginY = number;
export type OriginZ = number;
/**
 * Current UI assumes a normally oriented setup with machine Z pointing up.
 */
export type MachineZAxis = "positiveZ";
/**
 * Used when clearance height is computed from stock height.
 */
export type StockMaxZ = number;
export type Operation = Pocket2DOperationConfig;
export type OperationID = string;
export type OperationName = string;
export type Tool = string;
export type FeedsAndSpeeds = ManualFeedsAndSpeedsSelection | ToolMaterialFeedsAndSpeedsSelection;
export type Mode = "manual";
export type SpindleRPM = number;
export type PlungeFeedrate = number;
export type LeadInFeedrate = number;
export type CutFeedrate = number;
export type LeadOutFeedrate = number;
export type DepartureFeedrate = number;
export type Mode1 = "tool_material";
export type Materialid = string;
export type Toolmaterialfeedsandspeedsid = string;
export type Clearance = AbsoluteClearance | StockMaxZPlusOffsetClearance | PartMaxZPlusOffsetClearance;
export type Clearanceheighttype = "absolute";
export type AbsoluteHeight = number;
export type Clearanceheighttype1 = "stock_max_z_plus_offset";
export type Offset = number;
export type Clearanceheighttype2 = "part_max_z_plus_offset";
export type Offset1 = number;
export type DriveGeometryAt = "at_top" | "at_bottom";
export type DepthOfCut = number;
export type MaxStepdown = number;
export type OperationSorting = "selection" | "shortest_distance";
export type ChordalTolerance = number;
export type OperationKind = "pocket2d";
/**
 * @minItems 1
 */
export type CutAreas = [ClosedCurveSelection, ...ClosedCurveSelection[]];
export type DriveGeometryPlaneZ = number;
/**
 * Closed curves or closed surface edges captured from the selected mesh face.
 *
 * @minItems 3
 */
export type ClosedCurveVertices = [Point2D, Point2D, Point2D, ...Point2D[]];
export type X = number;
export type Y = number;
export type ClimbConventional = "climb" | "conventional";
export type Mode2 = "percentage_of_tool_diameter" | "absolute";
export type Value = number;
export type StockToLeave = number;

export interface GenerateToolpathRequest {
  setup?: Setup;
  operation: Operation;
  [k: string]: unknown;
}
export interface Setup {
  origin?: Origin;
  orientation?: Orientation;
  stock?: Stock;
  [k: string]: unknown;
}
export interface Origin {
  x?: OriginX;
  y?: OriginY;
  z?: OriginZ;
  [k: string]: unknown;
}
export interface Orientation {
  machineZAxis?: MachineZAxis;
  [k: string]: unknown;
}
export interface Stock {
  maxZ?: StockMaxZ;
  [k: string]: unknown;
}
export interface Pocket2DOperationConfig {
  id?: OperationID;
  displayName?: OperationName;
  toolId: Tool;
  feedsAndSpeeds?: FeedsAndSpeeds;
  clearance?: Clearance;
  levels?: Levels;
  advanced?: Advanced;
  kind?: OperationKind;
  driveGeometry: DriveGeometry;
  cutParameters?: CutParameters;
  [k: string]: unknown;
}
export interface ManualFeedsAndSpeedsSelection {
  mode?: Mode;
  feedsAndSpeeds?: FeedsAndSpeeds1;
  [k: string]: unknown;
}
export interface FeedsAndSpeeds1 {
  spindleRpm?: SpindleRPM;
  plungeFeedrate?: PlungeFeedrate;
  leadInFeedrate?: LeadInFeedrate;
  cutFeedrate?: CutFeedrate;
  leadOutFeedrate?: LeadOutFeedrate;
  departureFeedrate?: DepartureFeedrate;
  [k: string]: unknown;
}
export interface ToolMaterialFeedsAndSpeedsSelection {
  mode?: Mode1;
  materialId: Materialid;
  toolMaterialFeedsAndSpeedsId: Toolmaterialfeedsandspeedsid;
  [k: string]: unknown;
}
export interface AbsoluteClearance {
  clearanceHeightType?: Clearanceheighttype;
  absoluteHeight?: AbsoluteHeight;
  [k: string]: unknown;
}
export interface StockMaxZPlusOffsetClearance {
  clearanceHeightType?: Clearanceheighttype1;
  offset?: Offset;
  [k: string]: unknown;
}
export interface PartMaxZPlusOffsetClearance {
  clearanceHeightType?: Clearanceheighttype2;
  offset?: Offset1;
  [k: string]: unknown;
}
export interface Levels {
  driveGeometryPosition?: DriveGeometryAt;
  depthOfCut?: DepthOfCut;
  maxStepdown?: MaxStepdown;
  [k: string]: unknown;
}
export interface Advanced {
  operationsSorting?: OperationSorting;
  chordalTolerance?: ChordalTolerance;
  [k: string]: unknown;
}
export interface DriveGeometry {
  cutAreas: CutAreas;
  [k: string]: unknown;
}
export interface ClosedCurveSelection {
  planeZ: DriveGeometryPlaneZ;
  vertices: ClosedCurveVertices;
  [k: string]: unknown;
}
export interface Point2D {
  x: X;
  y: Y;
  [k: string]: unknown;
}
export interface CutParameters {
  cutDirection?: ClimbConventional;
  stepover?: Stepover;
  stockToLeave?: StockToLeave;
  [k: string]: unknown;
}
export interface Stepover {
  mode?: Mode2;
  value?: Value;
  [k: string]: unknown;
}
