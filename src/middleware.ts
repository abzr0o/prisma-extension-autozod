import { z } from "zod";
import type { ModelValidatorEntry } from "./registry.js";

/**
 * Shape of the AutoZod SQL middleware compatible with Prisma ORM 8 clients.
 */
export interface AutoZodMiddleware {
  /**
   * Unique identifier name for the middleware.
   */
  name: string;

  /**
   * Target storage engine family. Always 'sql' for PostgreSQL.
   */
  familyId: "sql";

  /**
   * Lifecycle hook invoked prior to SQL plan compilation.
   * Intercepts and validates AST mutation rows and values.
   */
  beforeCompile(draft: any, ctx: any): Promise<undefined>;
}

/**
 * Normalizes a key by stripping hyphens, underscores, and special characters,
 * and converting to lowercase.
 *
 * @param key The column or table string to normalize.
 * @returns A sanitized lowercase alphanumeric string.
 *
 * @example
 * ```typescript
 * normalizeKey("first_name"); // "firstname"
 * normalizeKey("User-Profile"); // "userprofile"
 * ```
 */
export function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Extracts raw value from Prisma 8 AST parameter references if wrapped in ParamRef.
 */
function extractValue(val: unknown): unknown {
  if (val && typeof val === "object" && "value" in val) {
    return (val as { value: unknown }).value;
  }
  return val;
}

/**
 * Inspects a compiled Prisma ORM 8 `contract.json` object and extracts a
 * dictionary of normalized table names mapped to their column list.
 *
 * @param contractJson The parsed Prisma 8 contract JSON object.
 * @returns A mapping from normalized table names to array of column names.
 *
 * @example
 * ```typescript
 * import contractJson from "./contract.json" with { type: "json" };
 *
 * const columns = extractColumns(contractJson);
 * console.log(columns["user"]); // ["id", "email", "name", ...]
 * ```
 */
export function extractColumns(contractJson: any): Record<string, string[]> {
  const tableCols: Record<string, string[]> = {};
  const namespaces = contractJson?.storage?.namespaces || {};

  for (const ns of Object.values(namespaces) as any[]) {
    // Prisma 8 contract storage entries: ns.entries.table or ns.tables
    const tables = ns?.entries?.table || ns?.tables || {};
    for (const [table, def] of Object.entries<any>(tables)) {
      tableCols[normalizeKey(table)] = Object.keys(def?.columns || {});
    }
  }
  return tableCols;
}

/**
 * Factory creating Prisma ORM 8 SQL middleware for automatic runtime Zod validation.
 *
 * Hooks into the query compiler via `beforeCompile` and intercepts `insert` and `update`
 * operations. Maps columns according to the contract, validates payload values against
 * registered Zod schemas, and throws `ZodError` before SQL execution if invalid.
 *
 * @param options.contract The parsed Prisma 8 `contract.json` object.
 * @param options.validators An array of validator entries produced by `createZodRegistry`.
 * @returns An `AutoZodMiddleware` instance ready to be passed to `postgres({ middleware: [...] })`.
 *
 * @example
 * ```typescript
 * import postgres from "@prisma/orm-postgres/runtime";
 * import { contractFromJson } from "@prisma/orm-postgres/static";
 * import { autoZodPrisma8 } from "prisma-extension-autozod";
 *
 * import contractJson from "./contract.json" with { type: "json" };
 * import { userValidator } from "./schemas.ts";
 *
 * export const contract = contractFromJson(contractJson);
 *
 * export const db = postgres({
 *   contract,
 *   url: process.env.DATABASE_URL!,
 *   middleware: [
 *     autoZodPrisma8({
 *       contract: contractJson,
 *       validators: [userValidator],
 *     }),
 *   ],
 * });
 * ```
 */
export function autoZodPrisma8(options: {
  contract: any;
  validators: ModelValidatorEntry[];
}): AutoZodMiddleware {
  const columnCatalog = extractColumns(options.contract);

  // Index validators by normalized table name
  const validatorMap = new Map<string, z.ZodObject<any>>();
  for (const entry of options.validators) {
    validatorMap.set(normalizeKey(entry.tableName), entry.schema);
  }

  return {
    name: "autozod-validator",
    familyId: "sql" as const,

    async beforeCompile(draft: any, ctx: any) {
      const ast = draft?.ast;
      if (!ast || (ast.kind !== "insert" && ast.kind !== "update")) return undefined;

      const target = ast.table?.name;
      if (!target) return undefined;

      const cleanTarget = normalizeKey(target);
      const schema = validatorMap.get(cleanTarget);
      if (!schema) return undefined;

      const targetCols = columnCatalog[cleanTarget] || [];
      const colLookup = new Map<string, string>();
      for (const col of targetCols) {
        colLookup.set(normalizeKey(col), col);
      }

      const validateFields = (rawRecord: Record<string, any>, isUpdate: boolean) => {
        const extracted: Record<string, any> = {};
        for (const [col, val] of Object.entries(rawRecord)) {
          const actualCol = colLookup.get(normalizeKey(col)) || col;
          extracted[actualCol] = extractValue(val);
        }

        // Validate fields declared in the Zod schema shape
        const schemaShape = (schema as any).shape || {};
        const schemaKeys = new Set(Object.keys(schemaShape));
        const toValidate: Record<string, any> = {};
        for (const [k, v] of Object.entries(extracted)) {
          if (schemaKeys.has(k)) {
            toValidate[k] = v;
          }
        }

        const activeSchema = isUpdate ? schema.partial() : schema;
        activeSchema.parse(toValidate);
      };

      if (ast.kind === "insert" && Array.isArray(ast.rows)) {
        for (const row of ast.rows) {
          validateFields(row, false);
        }
      } else if (ast.kind === "update" && ast.set) {
        validateFields(ast.set, true);
      }

      return undefined;
    },
  };
}

/**
 * Convenient alias for `autoZodPrisma8`.
 */
export const autoZod = autoZodPrisma8;
