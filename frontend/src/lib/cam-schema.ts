import { camSchemaBundle } from "@/generated/cam-schemas";
import type {
  GenerateToolpathRequest,
  Pocket2DOperationConfig,
} from "@/generated/cam-types";
import type { MeshFaceSelection } from "@/components/polyline-viewer";

type JsonPrimitive = string | number | boolean | null;
export type DraftValue = JsonPrimitive | DraftObject | DraftValue[];
export type DraftObject = { [key: string]: DraftValue | undefined };

export type OpenCamUiMetadata = {
  hidden?: boolean;
  readOnly?: boolean;
  tabId?: string;
  tabTitle?: string;
  unit?: string;
};

export type JsonSchema = {
  $defs?: Readonly<Record<string, JsonSchema>>;
  $ref?: string;
  anyOf?: readonly JsonSchema[];
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
        title: metadata.tabTitle ?? getSchemaTitle(childSchema, key, rootSchema),
      },
    ];
  });
}

function cloneValue<T>(value: T): T {
  return value === undefined ? value : structuredClone(value);
}

export function materializeDefaults(schema: JsonSchema, rootSchema: JsonSchema = pocketOperationSchema): DraftValue | undefined {
  const resolved = resolveSchema(schema, rootSchema);

  if (resolved.const !== undefined) {
    return resolved.const;
  }

  if (resolved.default !== undefined) {
    return cloneValue(resolved.default);
  }

  if (resolved.anyOf) {
    const preferredSchema = resolved.anyOf.find((option) => option.type !== "null") ?? resolved.anyOf[0];
    return preferredSchema ? materializeDefaults(preferredSchema, rootSchema) : undefined;
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

  if (resolved.anyOf) {
    const preferredSchema = resolved.anyOf.find((option) => option.type !== "null") ?? resolved.anyOf[0];
    return preferredSchema ? schemaValueToDraft(preferredSchema, value, rootSchema) : value;
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
    const nonNullableOption = resolved.anyOf.find((option) => option.type !== "null");

    if ((draft === "" || draft === undefined || draft === null) && nullableOption) {
      return null;
    }

    if (nonNullableOption) {
      return parseDraftValue(nonNullableOption, draft, rootSchema, path);
    }
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

export function setDraftValueAtPath(draft: DraftObject, path: readonly string[], value: DraftValue): DraftObject {
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
    source: "selectedFaceBoundary" as const,
    planeZ: selection.planeZ,
    vertices: selection.boundaryLoop.map(([x, y]) => ({ x, y })),
    selectionLabel: selection.label,
  };
}

export function createPocketOperationDraft(
  operationIndex: number,
  selection: MeshFaceSelection | null,
  meshMaxZ: number | null,
  existingOperation?: Pocket2DOperationConfig,
): DraftObject {
  const actualOperation =
    existingOperation ??
    ({
      ...(materializeDefaults(pocketOperationSchema, pocketOperationSchema) as DraftObject),
      id: crypto.randomUUID(),
      kind: "pocket2d",
      displayName: `2D Pocket ${operationIndex}`,
    } satisfies DraftObject);

  const driveGeometry = selection ? createDriveGeometryFromSelection(selection) : null;
  const hydratedOperation = {
    ...(actualOperation as DraftObject),
    pocket: {
      ...(((actualOperation as DraftObject).pocket as DraftObject | undefined) ?? {}),
      driveGeometry: driveGeometry ?? (((actualOperation as DraftObject).pocket as DraftObject | undefined)?.driveGeometry as DraftValue | undefined),
    },
    heights: {
      ...(((actualOperation as DraftObject).heights as DraftObject | undefined) ?? {}),
      topZ:
        existingOperation?.heights?.topZ ??
        meshMaxZ ??
        selection?.planeZ ??
        (((actualOperation as DraftObject).heights as DraftObject | undefined)?.topZ as DraftValue | undefined),
      bottomZ:
        existingOperation?.heights?.bottomZ ??
        selection?.planeZ ??
        (((actualOperation as DraftObject).heights as DraftObject | undefined)?.bottomZ as DraftValue | undefined),
    },
  } satisfies DraftObject;

  return schemaValueToDraft(pocketOperationSchema, hydratedOperation, pocketOperationSchema) as DraftObject;
}

export function parsePocketOperationDraft(draft: DraftObject): Pocket2DOperationConfig {
  return parseDraftValue(pocketOperationSchema, draft, pocketOperationSchema, "Operation") as Pocket2DOperationConfig;
}

export function buildGenerateToolpathRequest(
  operation: Pocket2DOperationConfig,
  meshMaxZ: number | null,
): GenerateToolpathRequest {
  return {
    setup: {
      origin: { x: 0, y: 0, z: 0 },
      orientation: { machineZAxis: "positiveZ" },
      stock: { maxZ: meshMaxZ ?? operation.heights?.topZ ?? 0 },
    },
    operation,
  };
}
