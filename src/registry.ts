import { z } from "zod";
import type {
  InvalidContractKeys,
  MissingContractKeys,
  ResolveColumn,
  ValidateZodAgainstContract,
} from "./type-lint.js";

/**
 * Represents a registered validator entry binding a table name to its Zod schema.
 */
export interface ModelValidatorEntry {
  /**
   * The name of the database table or model to validate against.
   */
  tableName: string;

  /**
   * The Zod object schema used to validate mutation payloads.
   */
  schema: z.ZodObject<any>;
}

/**
 * Creates a strongly typed validator registry factory bound to Prisma ORM 8 contract models.
 *
 * Provides compile-time checking ensuring that every field declared in your Zod schema
 * corresponds to a valid column on the database model. Fields with default or auto-generated
 * values (such as `id`, `createdAt`, `updatedAt`) can be omitted from the schema.
 *
 * @template TModels The generated Prisma 8 `Models` or `typeof models.public` type map.
 * @returns A factory function `(tableName, schema)` producing a typed `ModelValidatorEntry`.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { createZodRegistry } from "prisma-extension-autozod";
 * import type { models } from "./contract.d.ts";
 *
 * const defineModel = createZodRegistry<typeof models.public>();
 *
 * export const userValidator = defineModel(
 *   "User",
 *   z.object({
 *     email: z.string().email(),
 *     username: z.string().min(2),
 *     name: z.string().nullable().optional(),
 *   })
 * );
 * ```
 */
export function createZodRegistry<TModels extends Record<string, any>>() {
  return function <
    TTable extends keyof TModels & string,
    TShape extends z.ZodRawShape,
  >(
    tableName: TTable,
    schema: ValidateZodAgainstContract<
      TShape,
      Extract<keyof TModels[TTable], string>
    >,
  ): ModelValidatorEntry {
    return {
      tableName,
      schema: schema as unknown as z.ZodObject<any>,
    };
  };
}

/**
 * Creates a strict validator registry factory bound to Prisma ORM 8 contract models.
 *
 * In addition to rejecting unknown fields, this enforces that ALL columns defined on the
 * contract table MUST be declared in the Zod schema.
 *
 * @template TModels The generated Prisma 8 `Models` or `typeof models.public` type map.
 * @returns A factory function `(tableName, schema)` producing a typed `ModelValidatorEntry`.
 *
 * @example
 * ```typescript
 * import { z } from "zod";
 * import { createStrictZodRegistry } from "prisma-extension-autozod";
 * import type { models } from "./contract.d.ts";
 *
 * const defineStrict = createStrictZodRegistry<typeof models.public>();
 *
 * // Compile error if any column from the table contract is omitted:
 * export const userValidator = defineStrict(
 *   "User",
 *   z.object({
 *     id: z.number(),
 *     email: z.string().email(),
 *     username: z.string().nullable(),
 *     name: z.string().nullable(),
 *     createdAt: z.date(),
 *     updatedAt: z.date(),
 *   })
 * );
 * ```
 */
export function createStrictZodRegistry<TModels extends Record<string, any>>() {
  return function <
    TTable extends keyof TModels & string,
    TShape extends z.ZodRawShape,
  >(
    tableName: TTable,
    schema: [InvalidContractKeys<TShape, Extract<keyof TModels[TTable], string>>] extends [never]
      ? [MissingContractKeys<TShape, Extract<keyof TModels[TTable], string>>] extends [never]
        ? z.ZodObject<TShape>
        : {
            [K in MissingContractKeys<TShape, Extract<keyof TModels[TTable], string>>]: `[Prisma8-Contract-Error]: Missing required table column '${K}' in schema`;
          }
      : {
          [K in keyof TShape]: ResolveColumn<
            Extract<K, string>,
            Extract<keyof TModels[TTable], string>
          > extends never
            ? `[Prisma8-Contract-Error]: Field '${Extract<K, string>}' does not exist in table contract`
            : any;
        },
  ): ModelValidatorEntry {
    return {
      tableName,
      schema: schema as unknown as z.ZodObject<any>,
    };
  };
}
