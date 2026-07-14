/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface AbsoluteClearance {
  clearanceHeightType?: "absolute";
  absoluteHeight?: number;
}
export interface CAMSetup {
  origin?: SetupOrigin;
  orientation?: SetupOrientation;
  stock?: SetupStock;
}
export interface SetupOrigin {
  x?: number;
  y?: number;
  z?: number;
}
export interface SetupOrientation {
  /**
   * Current UI assumes a normally oriented setup with machine Z pointing up.
   */
  machineZAxis?: "positiveZ";
}
export interface SetupStock {
  /**
   * Used when clearance height is computed from stock height.
   */
  maxZ?: number;
}
export interface PartMaxZPlusOffsetClearance {
  clearanceHeightType?: "part_max_z_plus_offset";
  offset?: number;
}
export interface StockMaxZPlusOffsetClearance {
  clearanceHeightType?: "stock_max_z_plus_offset";
  offset?: number;
}
