import { z } from "zod";

/**
 * Normalizes a string type by stripping underscores and hyphens and converting to lowercase.
 */
export type CleanKey<S extends string> = Lowercase<
  S extends `${infer Head}_${infer Tail}`
    ? `${Head}${CleanKey<Tail>}`
    : S extends `${infer Head}-${infer Tail}`
      ? `${Head}${CleanKey<Tail>}`
      : S
>;

/**
 * Resolves a Zod field key against the list of contract column fields using case-insensitive matching.
 */
export type ResolveColumn<ZodKey extends string, ContractFields extends string> = {
  [Field in ContractFields]: CleanKey<Field> extends CleanKey<ZodKey>
    ? Field
    : never;
}[ContractFields];

/**
 * Returns any keys in `TShape` that do NOT correspond to a known column on the contract model.
 */
export type InvalidContractKeys<TShape, ContractFields extends string> = {
  [K in keyof TShape]: ResolveColumn<
    Extract<K, string>,
    ContractFields
  > extends never
    ? Extract<K, string>
    : never;
}[keyof TShape];

/**
 * Returns any contract column names that are missing in `TShape`.
 */
export type MissingContractKeys<TShape, ContractFields extends string> = {
  [Field in ContractFields]: CleanKey<Field> extends CleanKey<Extract<keyof TShape, string>>
    ? never
    : Field;
}[ContractFields];

/**
 * Compile-time linter type that verifies a Zod schema shape against Prisma 8 contract model fields.
 *
 * If all keys match, evaluates to `z.ZodObject<TShape>`.
 * If any invalid key exists, evaluates to an error object mapping each invalid key
 * to a descriptive compile error string.
 */
export type ValidateZodAgainstContract<
  TShape,
  ContractFields extends string,
> = [InvalidContractKeys<TShape, ContractFields>] extends [never]
  ? z.ZodObject<TShape & z.ZodRawShape>
  : {
      [K in keyof TShape]: ResolveColumn<
        Extract<K, string>,
        ContractFields
      > extends never
        ? `[Prisma8-Contract-Error]: Field '${Extract<K, string>}' does not exist in table contract`
        : any;
    };
