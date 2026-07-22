/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

export interface CAMSetup {
  partMesh?: (Mesh | CachedMesh) | null;
  clearanceOffset?: number;
  origin?: SetupOrigin;
  orientation?: SetupOrientation;
  stock?: SetupStock;
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
  sourceFaceIds?: number[] | null;
}
/**
 * A reference to a mesh cached in the server mesh cache.
 */
export interface CachedMesh {
  source?: "cached";
  cacheId: string;
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
