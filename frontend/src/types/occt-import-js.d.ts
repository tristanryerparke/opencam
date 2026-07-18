declare module "occt-import-js" {
  export type OcctReadParams = {
    linearUnit?: "millimeter" | "centimeter" | "meter" | "inch" | "foot";
    linearDeflectionType?: "bounding_box_ratio" | "absolute_value";
    linearDeflection?: number;
    angularDeflection?: number;
  };

  export type OcctBrepFace = {
    first: number;
    last: number;
    color?: [number, number, number] | null;
  };

  export type OcctMesh = {
    name?: string;
    color?: [number, number, number];
    brep_faces?: OcctBrepFace[];
    attributes?: {
      position?: { array: number[] };
      normal?: { array: number[] };
    };
    index?: { array: number[] };
  };

  export type OcctNode = {
    name: string;
    meshes: number[];
    children: OcctNode[];
  };

  export type OcctReadResult = {
    success: boolean;
    root?: OcctNode;
    meshes?: OcctMesh[];
    error?: string;
  };

  export type OcctModule = {
    ReadStepFile(content: Uint8Array, params: OcctReadParams | null): OcctReadResult;
  };

  export default function occtimportjs(options?: {
    locateFile?: (path: string, prefix: string) => string;
  }): Promise<OcctModule>;
}
