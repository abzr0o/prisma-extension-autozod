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
   * Intercepts, validates, and writes back AST mutation rows and values.
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
 * Checks whether an AST node is a Prisma 8 DefaultValueExpr placeholder
 * inserted during multi-row inserts with asymmetric keys.
 */
export function isDefaultValueExpr(val: unknown): boolean {
  if (!val || typeof val !== "object") return false;
  return (
    (val as any).kind === "default-value" ||
    (val as any).constructor?.name === "DefaultValueExpr"
  );
}

/**
 * Extracts the raw JavaScript value from Prisma 8 AST parameter references.
 * Automatically returns undefined for DefaultValueExpr nodes so Zod does not fail on them.
 */
export function extractValue(val: unknown): unknown {
  if (isDefaultValueExpr(val)) {
    return undefined;
  }
  if (val && typeof val === "object" && "value" in val) {
    return (val as { value: unknown }).value;
  }
  return val;
}

/**
 * Metadata for a model field extracted from contract.json.
 */
export interface ModelFieldMeta {
  modelFieldName: string;
  storageColumn: string;
  nullable: boolean;
  codecId?: string;
  hasDefault: boolean;
}

/**
 * Metadata for a domain model extracted from contract.json.
 */
export interface ModelContractMeta {
  modelName: string;
  storageTable: string;
  storageNamespace: string;
  modelFieldToColumn: Map<string, string>;
  columnToModelField: Map<string, string>;
  fields: Record<string, ModelFieldMeta>;
}

/**
 * Comprehensive metadata extracted from contract.json across all namespaces.
 */
export interface ContractMetadata {
  modelsByName: Map<string, ModelContractMeta>;
  modelsByTable: Map<string, ModelContractMeta>;
  columnsByTable: Record<string, string[]>;
}

/**
 * Inspects a compiled Prisma ORM 8 `contract.json` object and extracts
 * bidirectional mappings between domain models, storage tables, field names, and column names.
 *
 * @param contractJson The parsed Prisma 8 contract JSON object.
 * @returns A ContractMetadata object with indexed model and column lookups.
 */
export function extractContractMetadata(contractJson: any): ContractMetadata {
  const modelsByName = new Map<string, ModelContractMeta>();
  const modelsByTable = new Map<string, ModelContractMeta>();
  const columnsByTable: Record<string, string[]> = {};

  const domainNamespaces = contractJson?.domain?.namespaces || {};
  const storageNamespaces = contractJson?.storage?.namespaces || {};

  // 1. Collect storage table columns and default indicators
  const storageDefaults: Record<string, Record<string, boolean>> = {};
  for (const [, ns] of Object.entries<any>(storageNamespaces)) {
    const tables = ns?.entries?.table || ns?.tables || {};
    for (const [tableName, tableDef] of Object.entries<any>(tables)) {
      const cleanTable = normalizeKey(tableName);
      const cols = Object.keys(tableDef?.columns || {});
      columnsByTable[cleanTable] = cols;

      storageDefaults[cleanTable] = {};
      for (const [colName, colDef] of Object.entries<any>(
        tableDef?.columns || {},
      )) {
        storageDefaults[cleanTable][normalizeKey(colName)] =
          colDef?.default !== undefined;
      }
    }
  }

  // 2. Extract domain model definitions and mapping to storage tables and columns
  for (const [nsName, ns] of Object.entries<any>(domainNamespaces)) {
    const models = ns?.models || {};
    for (const [modelName, modelDef] of Object.entries<any>(models)) {
      const storageTable = modelDef?.storage?.table || modelName;
      const storageNs = modelDef?.storage?.namespaceId || nsName;
      const cleanModelName = normalizeKey(modelName);
      const cleanStorageTable = normalizeKey(storageTable);

      const modelFieldToColumn = new Map<string, string>();
      const columnToModelField = new Map<string, string>();
      const fields: Record<string, ModelFieldMeta> = {};

      const domainFields = modelDef?.fields || {};
      const storageFields = modelDef?.storage?.fields || {};

      for (const [fieldName, fieldDef] of Object.entries<any>(domainFields)) {
        const storageCol = storageFields[fieldName]?.column || fieldName;
        const cleanFieldName = normalizeKey(fieldName);
        const cleanColName = normalizeKey(storageCol);

        modelFieldToColumn.set(cleanFieldName, storageCol);
        modelFieldToColumn.set(cleanColName, storageCol);

        columnToModelField.set(cleanColName, fieldName);
        columnToModelField.set(cleanFieldName, fieldName);

        const hasDefault = Boolean(
          storageDefaults[cleanStorageTable]?.[cleanColName],
        );

        fields[fieldName] = {
          modelFieldName: fieldName,
          storageColumn: storageCol,
          nullable: Boolean(fieldDef?.nullable),
          codecId: fieldDef?.type?.codecId,
          hasDefault,
        };
      }

      const meta: ModelContractMeta = {
        modelName,
        storageTable,
        storageNamespace: storageNs,
        modelFieldToColumn,
        columnToModelField,
        fields,
      };

      modelsByName.set(cleanModelName, meta);
      modelsByTable.set(cleanStorageTable, meta);
    }
  }

  return { modelsByName, modelsByTable, columnsByTable };
}

/**
 * Inspects a compiled Prisma ORM 8 `contract.json` object and extracts a
 * dictionary of normalized table names mapped to their column list.
 *
 * @param contractJson The parsed Prisma 8 contract JSON object.
 * @returns A mapping from normalized table names to array of column names.
 */
export function extractColumns(contractJson: any): Record<string, string[]> {
  const metadata = extractContractMetadata(contractJson);
  return metadata.columnsByTable;
}

/**
 * Factory creating Prisma ORM 8 SQL middleware for automatic runtime Zod validation.
 *
 * Hooks into the query compiler via `beforeCompile` and intercepts `insert` and `update`
 * operations. Resolves domain model names to physical storage tables, maps model field
 * names to database columns, validates values, and writes back coerced, transformed,
 * and defaulted values into the AST parameter references.
 *
 * @param options.contract The parsed Prisma 8 `contract.json` object.
 * @param options.validators An array of validator entries or schemas created by createZodRegistry / createInsertSchema.
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
  validators: (
    | ModelValidatorEntry
    | (z.ZodObject<any> & { tableName?: string })
  )[];
}): AutoZodMiddleware {
  const contractMeta = extractContractMetadata(options.contract);

  // Index validators by both normalized model name and normalized storage table name
  const validatorMap = new Map<string, z.ZodObject<any>>();
  for (const entry of options.validators) {
    const rawName =
      (entry as any).tableName ||
      (entry as any)._tableName ||
      (entry as any).name;
    const schema = (entry as any).schema || entry;

    if (rawName && schema) {
      const cleanName = normalizeKey(rawName);
      validatorMap.set(cleanName, schema);

      const meta =
        contractMeta.modelsByName.get(cleanName) ||
        contractMeta.modelsByTable.get(cleanName);
      if (meta) {
        validatorMap.set(normalizeKey(meta.modelName), schema);
        validatorMap.set(normalizeKey(meta.storageTable), schema);
      }
    }
  }

  return {
    name: "autozod-validator",
    familyId: "sql" as const,

    async beforeCompile(draft: any, ctx: any) {
      const ast = draft?.ast;
      if (!ast || (ast.kind !== "insert" && ast.kind !== "update")) {
        return undefined;
      }

      const rawTable = ast.table?.name;
      if (!rawTable) return undefined;

      const cleanTable = normalizeKey(rawTable);
      const meta =
        contractMeta.modelsByTable.get(cleanTable) ||
        contractMeta.modelsByName.get(cleanTable);

      const schema =
        validatorMap.get(cleanTable) ||
        (meta ? validatorMap.get(normalizeKey(meta.modelName)) : undefined);
      if (!schema) return undefined;

      const schemaShape = (schema as any).shape || {};
      const schemaKeys = Object.keys(schemaShape);

      const validateAndWriteBack = (
        rawRecord: Record<string, any>,
        isUpdate: boolean,
      ) => {
        const toValidate: Record<string, any> = {};
        const defaultExprFields = new Set<string>();

        // 1. Extract values for keys expected by the Zod schema
        for (const expectedKey of schemaKeys) {
          // Check direct key match (e.g. storage column name first_name)
          if (expectedKey in rawRecord) {
            const raw = rawRecord[expectedKey];
            if (isDefaultValueExpr(raw)) {
              defaultExprFields.add(expectedKey);
            } else {
              toValidate[expectedKey] = extractValue(raw);
            }
            continue;
          }

          // Check domain model field name mapped to storage column (e.g. firstName -> first_name)
          const storageCol =
            meta?.modelFieldToColumn.get(normalizeKey(expectedKey));
          if (storageCol && storageCol in rawRecord) {
            const raw = rawRecord[storageCol];
            if (isDefaultValueExpr(raw)) {
              defaultExprFields.add(expectedKey);
            } else {
              toValidate[expectedKey] = extractValue(raw);
            }
            continue;
          }
        }

        // 2. Also check if rawRecord contains columns mapped to schema fields that were not matched yet
        for (const [col, val] of Object.entries(rawRecord)) {
          const mappedModelField = meta?.columnToModelField.get(
            normalizeKey(col),
          );
          if (mappedModelField && mappedModelField in schemaShape) {
            if (isDefaultValueExpr(val)) {
              defaultExprFields.add(mappedModelField);
            } else if (!(mappedModelField in toValidate)) {
              toValidate[mappedModelField] = extractValue(val);
            }
          }
        }

        // 3. Execute Zod validation
        // For updates, all fields are partial.
        // For inserts with DefaultValueExpr nodes (multi-row gaps), mark those specific fields optional.
        let activeSchema = isUpdate ? schema.partial() : schema;
        if (
          !isUpdate &&
          defaultExprFields.size > 0 &&
          typeof (schema as any).partial === "function"
        ) {
          const mask: Record<string, boolean> = {};
          for (const f of defaultExprFields) {
            mask[f] = true;
          }
          try {
            activeSchema = (schema as any).partial(mask);
          } catch {
            // Fallback if partial mask is not supported by custom schema
          }
        }

        const parsed = activeSchema.parse(toValidate);

        // 4. Write back validated, coerced, transformed, and defaulted values into AST ParamRefs
        if (parsed && typeof parsed === "object") {
          for (const [parsedKey, parsedVal] of Object.entries(parsed)) {
            // Find target storage column in rawRecord
            let storageCol = meta?.modelFieldToColumn.get(
              normalizeKey(parsedKey),
            );
            if (!storageCol || !(storageCol in rawRecord)) {
              if (parsedKey in rawRecord) {
                storageCol = parsedKey;
              }
            }

            if (storageCol && storageCol in rawRecord) {
              const current = rawRecord[storageCol];
              if (
                current &&
                typeof current === "object" &&
                "value" in current
              ) {
                // Mutate the ParamRef value in-place so compiled SQL receives the transformed value
                (current as any).value = parsedVal;
              } else if (isDefaultValueExpr(current)) {
                // If column had DefaultValueExpr, replace it if Zod provided a concrete default value
                rawRecord[storageCol] = { value: parsedVal };
              } else {
                rawRecord[storageCol] = parsedVal;
              }
            } else if (storageCol && !isUpdate) {
              // Field was defaulted by Zod schema and not present in original insert row
              rawRecord[storageCol] = { value: parsedVal };
            }
          }
        }
      };

      if (ast.kind === "insert" && Array.isArray(ast.rows)) {
        for (const row of ast.rows) {
          validateAndWriteBack(row, false);
        }
      } else if (ast.kind === "update" && ast.set) {
        validateAndWriteBack(ast.set, true);
      }

      return undefined;
    },
  };
}

/**
 * Convenient alias for `autoZodPrisma8`.
 */
export const autoZod = autoZodPrisma8;
