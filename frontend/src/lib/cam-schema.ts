import { camSchemaBundle } from "@/generated_schemas/cam.schemas";
import type {
  GenerateToolpathRequest,
  Pocketing2DOp as Operation,
} from "@/generated_schemas/cam";
import type { MeshFaceSelection } from "@/components/polyline-viewer";

type JsonPrimitive = string | number | boolean | null;
export type DraftValue = JsonPrimitive | DraftObject | DraftValue[];
export type DraftObject = { [key: string]: DraftValue | undefined };

export type OpenCamUiMetadata = {
  hidden?: boolean;
  readOnly?: boolean;
  unit?: string;
  widget?: "tool-select";
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
  return Object.entries(resolvedRoot.properties ?? {}).flatMap(([key, childSchema]) => {
    const resolvedChild = resolveSchema(childSchema, rootSchema);
    const metadata = getUiMetadata(childSchema, rootSchema);
    if (metadata.hidden) {
      return [];
    }

    return [
      {
        key,
        schema: resolvedChild,
        title: getSchemaTitle(childSchema, key, rootSchema),
      },
    ];
  });
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
  if (discriminator) {
    const selectedValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as DraftObject)[discriminator.propertyName]
        : undefined;
    if (typeof selectedValue === "string") {
      return options.find(
        (option) => getDiscriminatorValue(option, discriminator.propertyName, rootSchema) === selectedValue,
      );
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
    z: selection.planeZ,
    vertices: selection.boundaryLoop.map(([x, y]) => ({ x, y })),
  };
}

function getCutAreaList(value: DraftValue | undefined): DraftValue[] {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
}

export function createPocketOperationDraft(
  operationIndex: number,
  selection: MeshFaceSelection | null,
  _meshMaxZ: number | null,
  existingOperation?: Operation,
): DraftObject {
  const actualOperation =
    existingOperation ??
    ({
      ...(materializeDefaults(pocketOperationSchema, pocketOperationSchema) as DraftObject),
      id: crypto.randomUUID(),
      type: "pocketing_2d",
      displayName: `2D Pocket ${operationIndex}`,
    } satisfies DraftObject);

  const cutArea = selection ? createDriveGeometryFromSelection(selection) : null;
  const existingCutAreas = (((actualOperation as DraftObject).driveGeometry as DraftObject | undefined)
    ?.cutAreas as DraftValue | undefined);
  const hydratedOperation = {
    ...(actualOperation as DraftObject),
    driveGeometry: {
      ...(((actualOperation as DraftObject).driveGeometry as DraftObject | undefined) ?? {}),
      cutAreas: cutArea ? [cutArea] : existingCutAreas,
    },
  } satisfies DraftObject;

  return schemaValueToDraft(pocketOperationSchema, hydratedOperation, pocketOperationSchema) as DraftObject;
}

export function applySelectionToPocketOperationDraft(
  draft: DraftObject,
  selection: MeshFaceSelection,
  _meshMaxZ: number | null,
): DraftObject {
  const cutArea = createDriveGeometryFromSelection(selection);
  const driveGeometry = (draft.driveGeometry as DraftObject | undefined) ?? {};
  const cutAreas = [
    ...getCutAreaList(driveGeometry.cutAreas),
    ...(cutArea ? [cutArea] : []),
  ];

  return schemaValueToDraft(
    pocketOperationSchema,
    {
      ...draft,
      driveGeometry: {
        ...driveGeometry,
        cutAreas,
      },
    },
    pocketOperationSchema,
  ) as DraftObject;
}

export function parsePocketOperationDraft(draft: DraftObject): Operation {
  return parseDraftValue(pocketOperationSchema, draft, pocketOperationSchema, "Operation") as unknown as Operation;
}

export function buildGenerateToolpathRequest(
  operation: Operation,
  meshMaxZ: number | null,
): GenerateToolpathRequest {
  return {
    setup: {
      origin: { x: 0, y: 0, z: 0 },
      orientation: { machineZAxis: "positiveZ" },
      stock: { maxZ: meshMaxZ ?? 0 },
    },
    operation,
  };
}
