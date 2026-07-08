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
 * Used when transfer height is computed from stock height.
 */
export type StockMaxZ = number;
export type Operation = Pocket2DOperationConfig;
export type OperationID = string;
export type OperationKind = "pocket2d";
export type OperationName = string;
/**
 * @minItems 1
 */
export type DriveGeometries = [ClosedCurveSelection, ...ClosedCurveSelection[]];
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
export type Stepover = number;
export type StockToLeave = number;
export type PocketFromInsideOutside = "inside" | "outside";
export type Feedrate = number;
export type RPM = number;
export type Diameter = number;
export type FluteLength = number;
export type Tool1 = number;
export type ManualChange = boolean;
export type DriveGeometryAtTopBottom = "top" | "bottom";
export type HeightOfCutTopZ = number;
export type BottomZ = number;
/**
 * Maximum layer depth per pass.
 */
export type MaxCutDepth = number;
/**
 * Absolute clearance plane height used for retracts and transfers when selected.
 */
export type ClearancePlaneHeight = number;
/**
 * Use the clearance plane directly, or compute transfer height as stock max Z plus an offset.
 */
export type TransferHeight = "clearancePlane" | "stockTopPlusOffset";
/**
 * Only used when transfer height comes from stock max Z + X.
 */
export type TransferHeightOffset = number;
export type OperationSorting = "shortestTravel";
export type CutTransitions = "clearance";
export type LayerOrder = "perArea" | "perLayer";
export type ChordalTolerance = number;

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
  kind?: OperationKind;
  displayName?: OperationName;
  controlGeometry?: ControlGeometry;
  cutParameters?: CutParameters;
  material?: Material;
  tool?: Tool;
  levels?: Levels;
  clearance?: Clearence;
  advanced?: Advanced;
  [k: string]: unknown;
}
export interface ControlGeometry {
  driveGeometry: DriveGeometries;
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
  pocketStrategy?: PocketFromInsideOutside;
  [k: string]: unknown;
}
export interface Material {
  feedrate?: Feedrate;
  rpm?: RPM;
  [k: string]: unknown;
}
export interface Tool {
  diameter?: Diameter;
  fluteLength?: FluteLength;
  toolNumber?: Tool1;
  manualChange?: ManualChange;
  [k: string]: unknown;
}
export interface Levels {
  driveGeometryReference?: DriveGeometryAtTopBottom;
  topZ?: HeightOfCutTopZ;
  bottomZ?: BottomZ;
  maxCutDepth?: MaxCutDepth;
  [k: string]: unknown;
}
export interface Clearence {
  clearancePlaneHeight?: ClearancePlaneHeight;
  transferHeightMode?: TransferHeight;
  transferHeightOffset?: TransferHeightOffset;
  [k: string]: unknown;
}
export interface Advanced {
  operationSorting?: OperationSorting;
  cutTransitions?: CutTransitions;
  layerOrder?: LayerOrder;
  chordalTolerance?: ChordalTolerance;
  [k: string]: unknown;
}
