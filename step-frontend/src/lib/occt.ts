import occtimportjs, {
  type OcctModule,
  type OcctReadParams,
  type OcctReadResult,
} from "occt-import-js";
import wasmUrl from "occt-import-js/dist/occt-import-js.wasm?url";

let occtPromise: Promise<OcctModule> | null = null;

export function loadOcct() {
  occtPromise ??= occtimportjs({
    locateFile: (path) => (path.endsWith(".wasm") ? wasmUrl : path),
  });
  return occtPromise;
}

export async function readStepFile(file: File, params: OcctReadParams | null) {
  const [occt, buffer] = await Promise.all([loadOcct(), file.arrayBuffer()]);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

  const result: OcctReadResult = occt.ReadStepFile(new Uint8Array(buffer), params);
  if (!result.success) {
    throw new Error(result.error ?? "OpenCascade failed to read the STEP file.");
  }
  if (!result.meshes || result.meshes.length === 0) {
    throw new Error("STEP file loaded, but no meshes were returned.");
  }
  return result;
}
