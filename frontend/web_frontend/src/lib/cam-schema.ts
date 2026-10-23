import { camSchemaBundle } from "@/generated_schemas/cam.schemas";
import type { GenerateToolpathRequest } from "@/generated_schemas/cam";
import type { MeshFaceSelection } from "@/components/polyline-viewer/types";
import {
  type DraftObject,
  type JsonSchema,
  materializeDefaults,
  parseDraftValue,
  schemaValueToDraft,
} from "opencam-react-ui/operation-schema";

export type { DraftObject, DraftValue, JsonSchema } from "opencam-react-ui/operation-schema";
export type Operation = GenerateToolpathRequest["operation"];
export type OperationType = NonNullable<Operation["type"]>;

export const pocketOperationSchema = camSchemaBundle.pocket2dOperation as JsonSchema;
export const profileOperationSchema = camSchemaBundle.profile2dOperation as JsonSchema;
export const facingOperationSchema = camSchemaBundle.facing2dOperation as JsonSchema;
export const parallelFinishingOperationSchema = camSchemaBundle.parallelFinishingOperation as JsonSchema;

const operationSchemas: Record<OperationType, JsonSchema> = {
  pocketing_2d: pocketOperationSchema,
  profiling_2d: profileOperationSchema,
  facing_2d: facingOperationSchema,
  parallel_finishing: parallelFinishingOperationSchema,
};
const operationLabels: Record<OperationType, string> = {
  pocketing_2d: "2D Pocket",
  profiling_2d: "2D Profile",
  facing_2d: "2.5D Facing",
  parallel_finishing: "3D Parallel Finishing",
};

function operationTypeFromValue(value: OperationType | DraftObject | Operation | null | undefined): OperationType {
  if (value === "profiling_2d" || value === "pocketing_2d" || value === "facing_2d" || value === "parallel_finishing") return value;
  const type = value && typeof value === "object" && !Array.isArray(value) ? value.type : undefined;
  if (type === "profiling_2d" || type === "facing_2d" || type === "parallel_finishing") return type;
  return "pocketing_2d";
}

export function getOperationSchema(value: OperationType | DraftObject | Operation | null | undefined): JsonSchema {
  return operationSchemas[operationTypeFromValue(value)];
}

export function getOperationLabel(value: OperationType | DraftObject | Operation | null | undefined): string {
  return operationLabels[operationTypeFromValue(value)];
}

export function createDriveGeometryFromSelection(selection: MeshFaceSelection) {
  if (!selection.boundaryLoop || selection.planeZ == null) return null;
  return {
    kind: "closed_polyline",
    z: selection.planeZ,
    vertices: selection.boundaryLoop.map(([x, y]) => ({ x, y })),
  } satisfies DraftObject;
}

export function createOperationDraft(
  operationType: OperationType,
  operationIndex: number,
  selection: MeshFaceSelection | null,
  _meshMaxZ: number | null,
  existingOperation?: Operation,
): DraftObject {
  const rootSchema = getOperationSchema(existingOperation ?? operationType);
  const actualOperation: DraftObject = existingOperation
    ? existingOperation as unknown as DraftObject
    : {
      ...(materializeDefaults(rootSchema, rootSchema) as DraftObject),
      id: crypto.randomUUID(),
      type: operationType,
      displayName: `${getOperationLabel(operationType)} ${operationIndex}`,
    };
  const geometry = selection ? createDriveGeometryFromSelection(selection) : null;
  const hydratedOperation: DraftObject = { ...actualOperation, driveGeometry: geometry ? [geometry] : actualOperation.driveGeometry };
  return schemaValueToDraft(rootSchema, hydratedOperation, rootSchema) as DraftObject;
}

export function applySelectionToOperationDraft(draft: DraftObject, selection: MeshFaceSelection): DraftObject {
  const rootSchema = getOperationSchema(draft);
  const geometry = createDriveGeometryFromSelection(selection);
  if (!geometry) return draft;
  return schemaValueToDraft(rootSchema, { ...draft, driveGeometry: [...(Array.isArray(draft.driveGeometry) ? draft.driveGeometry : []), geometry] }, rootSchema) as DraftObject;
}

export function parseOperationDraft(draft: DraftObject): Operation {
  const rootSchema = getOperationSchema(draft);
  return parseDraftValue(rootSchema, draft, rootSchema, "Operation") as unknown as Operation;
}

export function buildGenerateToolpathRequest(
  operation: Operation,
  meshMaxZ: number | null,
  cachedMeshVersion?: string | null,
  clearanceOffset = 10,
): GenerateToolpathRequest {
  return {
    setup: {
      partMesh: cachedMeshVersion ? { source: "cached", cacheId: cachedMeshVersion } : undefined,
      origin: { x: 0, y: 0, z: 0 },
      orientation: { machineZAxis: "positiveZ" },
      stock: { maxZ: meshMaxZ ?? 0 },
      clearanceOffset,
    },
    operation,
  };
}
