/* tslint:disable */
/* eslint-disable */
/**
/* This file was automatically generated from pydantic models by running pydantic2ts.
/* Do not modify it by hand - just update the pydantic models and then re-run the script
*/

/**
 * A reference to a mesh cached in the server mesh cache.
 */
export interface CachedMesh {
  source?: "cached";
  cacheId: string;
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
}
