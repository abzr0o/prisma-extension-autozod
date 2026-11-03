# prisma-extension-autozod

[![npm version](https://img.shields.io/npm/v/prisma-extension-autozod.svg)](https://www.npmjs.com/package/prisma-extension-autozod)
[![CI](https://github.com/abzr0o/prisma-extension-autozod/actions/workflows/ci.yml/badge.svg)](https://github.com/abzr0o/prisma-extension-autozod/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Contract-aware compile-time linting and runtime Zod validation for the new Prisma ORM (@prisma/orm-postgres).

`prisma-extension-autozod` connects **Zod 4** and **Prisma ORM 8**. It provides two layers of safety:

1. **Compile-time Linting**: TypeScript flags any field in your Zod schema that does not exist in your Prisma data contract.
2. **Runtime Middleware**: Automatically intercepts write operations (`create`, `update`, `insert`) via Prisma 8's `beforeCompile` hook, validates payloads, normalizes column naming conventions, and blocks invalid mutations before SQL reaches your database.

---

## Why prisma-extension-autozod?

| Feature | Manual Controller Validation | Schema Generators (zod-prisma) | prisma-extension-autozod |
| :--- | :--- | :--- | :--- |
| **Zero Controller Boilerplate** | No (Manual `.parse()`) | No (Manual `.parse()`) | Yes (Auto-intercepted) |
| **Prisma 8 Native Architecture** | No | No | Yes (`beforeCompile` / Contract) |
| **Compile-Time Typo Linter** | No | No | Yes (Immediate IDE feedback) |
| **Casing Normalization** | No | No | Yes (`first_name` <-> `firstName`) |

---

## Requirements

- **Node.js**: `>= 22.0.0`
- **Prisma ORM**: `@prisma/orm-postgres >= 8.0.0`
- **Zod**: `^4.0.0`

---

## Features

- **Compile-Time Contract Linting**: Catches schema mismatches and invalid fields at build-time with clear TypeScript diagnostics.
- **Native Prisma ORM 8 Lifecycle Hook**: Hooks directly into the `beforeCompile` AST pipeline without monkey-patching.
- **Automatic Column Normalization**: Remaps input casing (e.g., `first_name` to `firstName`) based on your contract's column catalog.
- **Context-Aware Validation**: Full validation for `create`/`insert`, and automatic `.partial()` validation for `update` operations so omitted fields do not fail.
- **Flexible Strictness**: Choose between `createZodRegistry` (allows omitting auto-generated/default fields like `id` or `createdAt`) and `createStrictZodRegistry` (enforces full table column coverage).
- **Dual ESM & CJS**: Full TypeScript `.d.ts` declarations included out-of-the-box.

---

## Installation

```bash
# pnpm
pnpm add prisma-extension-autozod zod @prisma/orm-postgres

# npm
npm install prisma-extension-autozod zod @prisma/orm-postgres

# yarn
yarn add prisma-extension-autozod zod @prisma/orm-postgres
```

---

## Quickstart

### 1. Define Validated Schemas with Contract Linting

Bind your Zod schemas to your generated Prisma 8 `models` using `createZodRegistry`:

```typescript
import { z } from "zod";
import { createZodRegistry } from "prisma-extension-autozod";
import type { models } from "./contract.d.ts";

// Create a registry bound to your Prisma 8 contract models
const defineModel = createZodRegistry<typeof models.public>();

export const userValidator = defineModel(
  "User",
  z.object({
    email: z.string().email("Invalid email address"),
    username: z
      .string()
      .min(2, "Username must be at least 2 characters")
      .nullable()
      .optional(),
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .nullable()
      .optional(),
  }),
);
```

> **Compile-Time Safety in Action:**
> If you add a field that does not exist in the contract:
>
> ```typescript
> defineModel(
>   "User",
>   z.object({
>     nonExistentColumn: z.string(), // Error: Field 'nonExistentColumn' does not exist in table contract
>   }),
> );
> ```

---

### 2. Register Middleware in Your Prisma 8 Client

Pass the middleware to your `@prisma/orm-postgres` client setup:

```typescript
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { autoZodPrisma8 } from "prisma-extension-autozod";

import contractJson from "./contract.json" with { type: "json" };
import { userValidator } from "./schemas.ts";

export const contract = contractFromJson(contractJson);

export const db = postgres({
  contract,
  url: process.env.DATABASE_URL!,
  middleware: [
    autoZodPrisma8({
      contract: contractJson,
      validators: [userValidator],
    }),
  ],
});
```

---

### 3. Automatic Validation & Sanitization

In the new Prisma ORM, models are accessed via `db.orm.<namespace>.<ModelName>`:

```typescript
// Valid: Passes validation and executes
await db.orm.public.User.create({
  email: "alice@prisma.io",
  username: "alice",
  name: "Alice Smith",
});

// Invalid: Throws standard ZodError before hitting the database
await db.orm.public.User.create({
  email: "not-an-email",
  username: "a", // too short (< 2 characters)
  name: "Alice",
});

// Update: Only supplied fields are validated
await db.orm.public.User.where({ email: "alice@prisma.io" }).update({
  name: "Alice Wonder", // Valid; other fields are not required on updates
});
```

---

### 4. Column Normalization in Action

Incoming payloads from frontend forms or REST APIs often use `snake_case`. The middleware automatically remaps them to match your contract columns:

```typescript
// Incoming frontend payload uses snake_case:
await db.orm.public.User.create({
  first_name: "Alice", // Automatically remapped to `firstName` in Postgres
  email: "alice@prisma.io",
});
```

---

### 5. Error Handling DX

Because validation throws standard `ZodError` instances, you can easily catch and format errors for HTTP responses in Express, NestJS, Fastify, or Hono:

```typescript
import { ZodError } from "zod";

try {
  await db.orm.public.User.create(req.body);
} catch (error) {
  if (error instanceof ZodError) {
    // Clean flattened validation errors directly back to the client
    return res.status(400).json({ errors: error.flatten().fieldErrors });
  }
  throw error;
}
```

---

## API Reference

### `createZodRegistry<TModels>()`

Creates a model validator factory bound to your contract models. Validates that all fields in the schema exist in the contract table, allowing omission of auto-generated or optional fields.

```typescript
const defineModel = createZodRegistry<typeof models.public>();
const userValidator = defineModel("User", zodSchema);
```

### `createStrictZodRegistry<TModels>()`

Creates a strict validator factory that requires all columns in the contract table to be declared in the schema, while also rejecting unknown fields.

```typescript
const defineStrict = createStrictZodRegistry<typeof models.public>();
const userValidator = defineStrict("User", zodSchema);
```

### `autoZodPrisma8(options)` (alias: `autoZod`)

Prisma ORM 8 middleware factory:

- `options.contract`: The raw `contract.json` object.
- `options.validators`: Array of validator entries returned by `createZodRegistry` or `createStrictZodRegistry`.

### `extractColumns(contractJson)`

Helper function that inspects storage namespaces inside `contract.json` and returns a normalized dictionary of table column names.

### `normalizeKey(key: string)`

Normalizes strings to lowercase alphanumeric format for reliable case- and separator-insensitive mapping.

---

## Development & Testing

```bash
# Install dependencies
pnpm install

# Run tests
pnpm test

# Typecheck
pnpm run typecheck

# Build bundle (ESM + CJS + DTS)
pnpm run build
```

---

## Contributing

Contributions, bug reports, and feature requests are welcome!  
Feel free to check the [issues page](https://github.com/abzr0o/prisma-extension-autozod/issues).

## Support

If this library saves you time or prevents schema bugs in production, consider giving it a star on [GitHub](https://github.com/abzr0o/prisma-extension-autozod)!

---

## License

[MIT](LICENSE) (c) [Mohammed Thamer](https://github.com/abzr0o)
