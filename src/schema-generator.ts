import { z } from "zod";
import { extractContractMetadata, normalizeKey } from "./middleware.js";

/**
 * Refinement mapping allowing custom Zod schemas or mutator functions per field.
 */
export type SchemaRefinements = Record<
  string,
  z.ZodTypeAny | ((base: z.ZodTypeAny) => z.ZodTypeAny)
>;

/**
 * Map Prisma 8 SQL codec IDs to their corresponding base Zod types.
 */
export function codecToZodSchema(codecId?: string): z.ZodTypeAny {
  if (!codecId) return z.any();

  const id = codecId.toLowerCase();

  // Strings & Text
  if (id.includes("uuid")) {
    return z.string().uuid();
  }
  if (
    id.includes("/text") ||
    id.includes("/varchar") ||
    id.includes("/char") ||
    id.includes("/citext")
  ) {
    return z.string();
  }

  // Integers
  if (id.includes("/int2") || id.includes("/int4")) {
    return z.number().int();
  }

  // Floats & Decimals
  if (id.includes("/float") || id.includes("/numeric")) {
    return z.number();
  }

  // BigInt
  if (id.includes("/int8")) {
    return z.union([z.bigint(), z.number()]);
  }

  // Boolean
  if (id.includes("/bool")) {
    return z.boolean();
  }

  // Dates & Timestamps
  if (id.includes("/time") || id.includes("/date")) {
    return z.union([z.date(), z.string()]);
  }

  // JSON
  if (id.includes("/json")) {
    return z.any();
  }

  // Bytea
  if (id.includes("/bytea")) {
    return z.union([z.instanceof(Uint8Array), z.string()]);
  }

  return z.any();
}

/**
 * Automatically infers a complete Zod insert schema from a Prisma ORM 8 `contract.json`.
 *
 * Fields with database defaults (e.g. autoincrement ID, now() timestamps) are automatically
 * marked optional. Nullable columns are marked nullable. You can refine or override individual
 * fields with custom validation rules.
 *
 * @param contract The parsed Prisma 8 `contract.json` object.
 * @param modelName The model name in your contract (e.g., "User" or "Post").
 * @param refinements Optional mapping to customize or extend specific field schemas.
 * @returns A ZodObject schema with a `.tableName` property ready for route validation or AutoZod middleware.
 *
 * @example
 * ```typescript
 * import contractJson from "./contract.json" with { type: "json" };
 * import { createInsertSchema } from "prisma-extension-autozod";
 *
 * export const userCreateSchema = createInsertSchema(contractJson, "User", {
 *   email: (s) => s.email("Must be a valid email"),
 *   name: (s) => s.min(2),
 * });
 * ```
 */
export function createInsertSchema<
  TContract extends Record<string, any> = any,
  TModel extends string = string,
>(
  contract: TContract,
  modelName: TModel,
  refinements?: SchemaRefinements,
): z.ZodObject<any> & { tableName: TModel } {
  const metadata = extractContractMetadata(contract);
  const modelMeta =
    metadata.modelsByName.get(normalizeKey(modelName)) ||
    metadata.modelsByTable.get(normalizeKey(modelName));

  if (!modelMeta) {
    const available = Array.from(metadata.modelsByName.values())
      .map((m) => m.modelName)
      .join(", ");
    throw new Error(
      `[prisma-extension-autozod]: Model '${modelName}' not found in contract. Available models: ${available || "none"}`,
    );
  }

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [fieldName, fieldMeta] of Object.entries(modelMeta.fields)) {
    let fieldSchema = codecToZodSchema(fieldMeta.codecId);

    // Apply nullability
    if (fieldMeta.nullable) {
      fieldSchema = fieldSchema.nullable();
    }

    // Apply database default -> optional in insert schema
    if (fieldMeta.hasDefault) {
      fieldSchema = fieldSchema.optional();
    }

    // Apply custom refinements
    const custom =
      refinements?.[fieldName] || refinements?.[fieldMeta.storageColumn];
    if (custom) {
      fieldSchema =
        typeof custom === "function" ? custom(fieldSchema) : custom;
    }

    shape[fieldName] = fieldSchema;
  }

  const schema = z.object(shape) as any;
  schema.tableName = modelName;
  return schema;
}

/**
 * Automatically infers a Zod update schema from a Prisma ORM 8 `contract.json`.
 *
 * Equivalent to `createInsertSchema(...).partial()`.
 *
 * @param contract The parsed Prisma 8 `contract.json` object.
 * @param modelName The model name in your contract.
 * @param refinements Optional mapping to customize or extend specific field schemas.
 * @returns A partial ZodObject schema with a `.tableName` property.
 *
 * @example
 * ```typescript
 * export const userUpdateSchema = createUpdateSchema(contractJson, "User", {
 *   email: (s) => s.email(),
 * });
 * ```
 */
export function createUpdateSchema<
  TContract extends Record<string, any> = any,
  TModel extends string = string,
>(
  contract: TContract,
  modelName: TModel,
  refinements?: SchemaRefinements,
): z.ZodObject<any> & { tableName: TModel } {
  const insertSchema = createInsertSchema(contract, modelName, refinements);
  const updateSchema = insertSchema.partial() as any;
  updateSchema.tableName = modelName;
  return updateSchema;
}
