/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

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
export interface ClosedPolyline2D {
  kind?: "closed_polyline";
  vertices: Point2D[];
}
export interface Polyline25D {
  kind?: "polyline";
  vertices: Point2D[];
  z: number;
}
export interface Polyline2D {
  kind?: "polyline";
  vertices: Point2D[];
}
