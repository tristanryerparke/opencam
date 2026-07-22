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
export interface AutomaticClearance {
  clearanceHeightType?: "automatic";
}
export interface CAMAdvancedParameters {
  operationsSorting?: "selection" | "shortest_distance";
  chordalTolerance?: number;
}
export interface CAMLevels {
  driveGeometryPosition?: "at_top" | "at_bottom";
  depthOfCut?: number;
  maxStepdown?: number;
}
export interface FeedsAndSpeeds {
  spindleRpm?: number;
  plungeFeedrate?: number;
  leadInFeedrate?: number;
  cutFeedrate?: number;
  leadOutFeedrate?: number;
  departureFeedrate?: number;
}
export interface PartMaxZPlusOffsetClearance {
  clearanceHeightType?: "part_max_z_plus_offset";
  offset?: number;
}
export interface StockMaxZPlusOffsetClearance {
  clearanceHeightType?: "stock_max_z_plus_offset";
  offset?: number;
}
