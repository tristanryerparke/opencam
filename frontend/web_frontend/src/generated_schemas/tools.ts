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
}
