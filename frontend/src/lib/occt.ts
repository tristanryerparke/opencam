import occtimportjs, { type OcctReadParams, type OcctReadResult } from "occt-import-js";
import occtWasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

let occtPromise: ReturnType<typeof occtimportjs> | null = null;

function getOcct() {
  occtPromise ??= occtimportjs({
    locateFile: (path, prefix) => path.endsWith(".wasm") ? occtWasmUrl : prefix + path,
  });
  return occtPromise;
}

export async function readStepBuffer(buffer: ArrayBuffer, params: OcctReadParams): Promise<OcctReadResult> {
  const occt = await getOcct();
  const result = occt.ReadStepFile(new Uint8Array(buffer), params);

  if (!result.success) {
    throw new Error(result.error ?? "OpenCascade failed to read the STEP file.");
  }
  if (!result.meshes?.length) {
    throw new Error("STEP file loaded, but no meshes were returned.");
  }

  return result;
}
