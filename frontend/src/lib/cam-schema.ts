import { camSchemaBundle } from "@/generated_schemas/cam.schemas";
import type { GenerateToolpathRequest } from "@/generated_schemas/cam";
import type { MeshFaceSelection } from "@/components/polyline-viewer/types";

type JsonPrimitive = string | number | boolean | null;
export type DraftValue = JsonPrimitive | DraftObject | DraftValue[];
export type DraftObject = { [key: string]: DraftValue | undefined };
export type Operation = GenerateToolpathRequest["operation"];
export type OperationType = NonNullable<Operation["type"]>;

export type OpenCamUiMetadata = {
  readOnly?: boolean;
  unit?: string;
};

export type JsonSchema = {
  $defs?: Readonly<Record<string, JsonSchema>>;
  $ref?: string;
  anyOf?: readonly JsonSchema[];
  oneOf?: readonly JsonSchema[];
  discriminator?: {
    propertyName: string;
    mapping?: Readonly<Record<string, string>>;
  };
  const?: JsonPrimitive;
  default?: DraftValue;
  description?: string;
  enum?: readonly string[];
  exclusiveMinimum?: number;
  maximum?: number;
  minimum?: number;
  minItems?: number;
  items?: JsonSchema;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: readonly string[];
  title?: string;
  type?: string;
  "x-opencam"?: OpenCamUiMetadata;
};

export type SchemaSection = {
  key: string;
  schema: JsonSchema;
  title: string;
};

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
  parallel_finishing: "Parallel Finishing",
};

const hiddenOperationFields = new Set(["type", "id", "displayName"]);
const operationSectionOrder = new Map([
  ["driveGeometry", 0],
  ["cutParameters", 1],
  ["tool", 2],
  ["feedsAndSpeeds", 3],
  ["levels", 4],
  ["clearance", 5],
  ["advanced", 6],
]);
const operationSectionTitles: Record<string, string> = {
  driveGeometry: "Drive Geometry",
  cutParameters: "Cut Parameters",
  tool: "Tool",
  feedsAndSpeeds: "Feeds and Speeds",
  levels: "Levels",
  clearance: "Clearance",
  advanced: "Advanced",
};

function operationTypeFromValue(value: OperationType | DraftObject | Operation | null | undefined): OperationType {
  if (value === "profiling_2d" || value === "pocketing_2d" || value === "facing_2d" || value === "parallel_finishing") {
    return value;
  }
  const type = value && typeof value === "object" && !Array.isArray(value) ? value.type : undefined;
  if (type === "profiling_2d") return "profiling_2d";
  if (type === "facing_2d") return "facing_2d";
  if (type === "parallel_finishing") return "parallel_finishing";
  return "pocketing_2d";
}

export function getOperationSchema(value: OperationType | DraftObject | Operation | null | undefined): JsonSchema {
  return operationSchemas[operationTypeFromValue(value)];
}

export function getOperationLabel(value: OperationType | DraftObject | Operation | null | undefined): string {
  return operationLabels[operationTypeFromValue(value)];
}

export function resolveSchema(schema: JsonSchema, rootSchema: JsonSchema = pocketOperationSchema): JsonSchema {
  if (!schema.$ref) {
    return schema;
  }

  const refKey = schema.$ref.replace("#/$defs/", "");
  return rootSchema.$defs?.[refKey] ?? schema;
}

export function getUiMetadata(schema: JsonSchema, rootSchema: JsonSchema = pocketOperationSchema): OpenCamUiMetadata {
  const resolved = resolveSchema(schema, rootSchema);
  return resolved["x-opencam"] ?? schema["x-opencam"] ?? {};
}

export function getSchemaTitle(schema: JsonSchema, fallback: string, rootSchema: JsonSchema = pocketOperationSchema) {
  return schema.title ?? resolveSchema(schema, rootSchema).title ?? fallback;
}

export function getVisibleSections(rootSchema: JsonSchema = pocketOperationSchema): SchemaSection[] {
  const resolvedRoot = resolveSchema(rootSchema, rootSchema);
  return Object.entries(resolvedRoot.properties ?? {})
    .flatMap(([key, childSchema]) => {
      if (hiddenOperationFields.has(key)) {
        return [];
      }

      const resolvedChild = resolveSchema(childSchema, rootSchema);
      return [
        {
          key,
          schema: resolvedChild,
          title: operationSectionTitles[key] ?? getSchemaTitle(childSchema, key, rootSchema),
        },
      ];
    })
    .sort(
      (left, right) =>
        (operationSectionOrder.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (operationSectionOrder.get(right.key) ?? Number.MAX_SAFE_INTEGER),
    );
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

function getUnionOptions(schema: JsonSchema, rootSchema: JsonSchema) {
  const resolved = resolveSchema(schema, rootSchema);
  return (resolved.oneOf ?? resolved.anyOf ?? []).map((option) => resolveSchema(option, rootSchema));
}

function getDiscriminatorValue(schema: JsonSchema, propertyName: string, rootSchema: JsonSchema) {
  const property = schema.properties?.[propertyName];
  const resolvedProperty = property ? resolveSchema(property, rootSchema) : undefined;
  const value = resolvedProperty?.const ?? resolvedProperty?.default;
  return typeof value === "string" ? value : undefined;
}

export function getDiscriminatedUnionOptions(schema: JsonSchema, rootSchema: JsonSchema = pocketOperationSchema) {
  const resolved = resolveSchema(schema, rootSchema);
  const discriminator = resolved.discriminator;
  if (!discriminator) {
    return [];
  }

  return getUnionOptions(resolved, rootSchema).flatMap((option) => {
    const value = getDiscriminatorValue(option, discriminator.propertyName, rootSchema);
    return value ? [{ value, schema: option }] : [];
  });
}

function getUnionSchemaForValue(
  schema: JsonSchema,
  value: DraftValue | undefined,
  rootSchema: JsonSchema,
) {
  const resolved = resolveSchema(schema, rootSchema);
  const options = getUnionOptions(resolved, rootSchema);
  if (options.length === 0) {
    return undefined;
  }

  const discriminator = resolved.discriminator;
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as DraftObject) : undefined;
  if (discriminator) {
    const selectedValue = source?.[discriminator.propertyName];
    if (typeof selectedValue === "string") {
      return options.find(
        (option) => getDiscriminatorValue(option, discriminator.propertyName, rootSchema) === selectedValue,
      );
    }
  }

  if (source) {
    const matchingOption = options.find((option) =>
      Object.entries(option.properties ?? {}).some(([key, property]) => {
        const expected = resolveSchema(property, rootSchema).const;
        return expected !== undefined && source[key] === expected;
      }),
    );
    if (matchingOption) {
      return matchingOption;
    }
  }

  return options.find((option) => option.type !== "null") ?? options[0];
}

export function materializeDefaults(schema: JsonSchema, rootSchema: JsonSchema = pocketOperationSchema): DraftValue | undefined {
  const resolved = resolveSchema(schema, rootSchema);

  if (resolved.const !== undefined) {
    return resolved.const;
  }

  if (resolved.default !== undefined) {
    return cloneValue(resolved.default);
  }

  const unionSchema = getUnionSchemaForValue(resolved, undefined, rootSchema);
  if (unionSchema) {
    return materializeDefaults(unionSchema, rootSchema);
  }

  if (resolved.properties) {
    const result: DraftObject = {};
    for (const [key, childSchema] of Object.entries(resolved.properties)) {
      const childDefault = materializeDefaults(childSchema, rootSchema);
      if (childDefault !== undefined) {
        result[key] = childDefault;
      }
    }
    return result;
  }

  if (resolved.type === "boolean") {
    return false;
  }

  return undefined;
}

export function schemaValueToDraft(schema: JsonSchema, value: DraftValue | undefined, rootSchema: JsonSchema = pocketOperationSchema): DraftValue | undefined {
  const resolved = resolveSchema(schema, rootSchema);
  const metadata = getUiMetadata(schema, rootSchema);

  if (value === undefined) {
    return materializeDefaults(schema, rootSchema);
  }

  if (metadata.readOnly) {
    return cloneValue(value);
  }

  const unionSchema = getUnionSchemaForValue(resolved, value, rootSchema);
  if (unionSchema) {
    return schemaValueToDraft(unionSchema, value, rootSchema);
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    return typeof value === "number" ? String(value) : value;
  }

  if (resolved.properties && value && typeof value === "object" && !Array.isArray(value)) {
    const result: DraftObject = {};
    for (const [key, childSchema] of Object.entries(resolved.properties)) {
      result[key] = schemaValueToDraft(
        childSchema,
        (value as DraftObject)[key],
        rootSchema,
      );
    }
    return result;
  }

  return cloneValue(value);
}

function validateNumericValue(schema: JsonSchema, value: number, path: string) {
  if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) {
    throw new Error(`${path} must be greater than ${schema.exclusiveMinimum}.`);
  }
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new Error(`${path} must be at least ${schema.minimum}.`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new Error(`${path} must be at most ${schema.maximum}.`);
  }
}

export function parseDraftValue(schema: JsonSchema, draft: DraftValue | undefined, rootSchema: JsonSchema = pocketOperationSchema, path = getSchemaTitle(schema, "Field", rootSchema)): DraftValue {
  const resolved = resolveSchema(schema, rootSchema);

  if (resolved.const !== undefined) {
    return resolved.const;
  }

  if (resolved.anyOf) {
    const nullableOption = resolved.anyOf.find((option) => option.type === "null");
    if ((draft === "" || draft === undefined || draft === null) && nullableOption) {
      return null;
    }
  }

  const unionSchema = getUnionSchemaForValue(resolved, draft, rootSchema);
  if (unionSchema) {
    return parseDraftValue(unionSchema, draft, rootSchema, path);
  }

  if (resolved.properties) {
    const source = draft && typeof draft === "object" && !Array.isArray(draft) ? (draft as DraftObject) : {};
    const result: DraftObject = {};

    for (const [key, childSchema] of Object.entries(resolved.properties)) {
      const childTitle = getSchemaTitle(childSchema, key, rootSchema);
      const childDraft = source[key];
      const childValue = parseDraftValue(childSchema, childDraft, rootSchema, childTitle);
      if (childValue !== undefined) {
        result[key] = childValue;
      }
    }

    return result;
  }

  if (resolved.enum) {
    const value = typeof draft === "string" ? draft : resolved.default;
    if (typeof value !== "string" || !resolved.enum.includes(value)) {
      throw new Error(`${path} is required.`);
    }
    return value;
  }

  if (resolved.type === "boolean") {
    if (typeof draft === "boolean") {
      return draft;
    }
    return typeof resolved.default === "boolean" ? resolved.default : false;
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    if (typeof draft === "number") {
      validateNumericValue(resolved, draft, path);
      if (resolved.type === "integer" && !Number.isInteger(draft)) {
        throw new Error(`${path} must be a whole number.`);
      }
      return draft;
    }

    const value = typeof draft === "string" ? draft.trim() : "";
    if (value === "") {
      if (typeof resolved.default === "number") {
        return resolved.default;
      }
      throw new Error(`${path} is required.`);
    }

    const parsedNumber = Number(value);
    if (!Number.isFinite(parsedNumber)) {
      throw new Error(`${path} must be a valid number.`);
    }

    if (resolved.type === "integer" && !Number.isInteger(parsedNumber)) {
      throw new Error(`${path} must be a whole number.`);
    }

    validateNumericValue(resolved, parsedNumber, path);
    return parsedNumber;
  }

  if (resolved.type === "array") {
    if (!Array.isArray(draft)) {
      if (resolved.default !== undefined) {
        return cloneValue(resolved.default);
      }
      throw new Error(`${path} is required.`);
    }

    if (resolved.minItems !== undefined && draft.length < resolved.minItems) {
      throw new Error(`${path} must have at least ${resolved.minItems} items.`);
    }

    if (resolved.items) {
      return draft.map((item, index) => parseDraftValue(resolved.items!, item, rootSchema, `${path} ${index + 1}`));
    }

    return cloneValue(draft);
  }

  if (resolved.type === "string" || resolved.type === undefined) {
    if (typeof draft === "string") {
      if (draft.trim() === "" && resolved.default !== undefined) {
        return String(resolved.default);
      }
      if (draft.trim() === "" && resolved.default === undefined) {
        throw new Error(`${path} is required.`);
      }
      return draft;
    }

    if (typeof resolved.default === "string") {
      return resolved.default;
    }
  }

  if (draft !== undefined) {
    return cloneValue(draft);
  }

  if (resolved.default !== undefined) {
    return cloneValue(resolved.default);
  }

  throw new Error(`${path} is required.`);
}

export function setDraftValueAtPath(draft: DraftObject, path: readonly string[], value: DraftValue | undefined): DraftObject {
  if (path.length === 0) {
    return draft;
  }

  const [key, ...rest] = path;
  if (!key) {
    return draft;
  }

  if (rest.length === 0) {
    return {
      ...draft,
      [key]: value,
    };
  }

  const currentChild = draft[key];
  const nextChild =
    currentChild && typeof currentChild === "object" && !Array.isArray(currentChild)
      ? (currentChild as DraftObject)
      : {};

  return {
    ...draft,
    [key]: setDraftValueAtPath(nextChild, rest, value),
  };
}

export function createDriveGeometryFromSelection(selection: MeshFaceSelection) {
  if (!selection.boundaryLoop || selection.planeZ == null) {
    return null;
  }

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
  const actualOperation =
    existingOperation ??
    ({
      ...(materializeDefaults(rootSchema, rootSchema) as DraftObject),
      id: crypto.randomUUID(),
      type: operationType,
      displayName: `${getOperationLabel(operationType)} ${operationIndex}`,
    } satisfies DraftObject);
  const geometry = selection ? createDriveGeometryFromSelection(selection) : null;
  const actualDriveGeometry = (actualOperation as DraftObject).driveGeometry;
  const hydratedOperation = {
    ...(actualOperation as DraftObject),
    driveGeometry: geometry ? [geometry] : actualDriveGeometry,
  } satisfies DraftObject;

  return schemaValueToDraft(rootSchema, hydratedOperation, rootSchema) as DraftObject;
}

export function applySelectionToOperationDraft(
  draft: DraftObject,
  selection: MeshFaceSelection,
): DraftObject {
  const rootSchema = getOperationSchema(draft);
  const geometry = createDriveGeometryFromSelection(selection);
  if (!geometry) {
    return draft;
  }

  const geometries = [
    ...(Array.isArray(draft.driveGeometry) ? draft.driveGeometry : []),
    geometry,
  ];

  return schemaValueToDraft(
    rootSchema,
    { ...draft, driveGeometry: geometries },
    rootSchema,
  ) as DraftObject;
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
      partMesh: cachedMeshVersion
        ? { source: "cached", cacheId: cachedMeshVersion }
        : undefined,
      origin: { x: 0, y: 0, z: 0 },
      orientation: { machineZAxis: "positiveZ" },
      stock: { maxZ: meshMaxZ ?? 0 },
      clearanceOffset,
    },
    operation,
  };
}
