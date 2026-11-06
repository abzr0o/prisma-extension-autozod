# prisma-extension-autozod

[![npm version](https://img.shields.io/npm/v/prisma-extension-autozod.svg)](https://www.npmjs.com/package/prisma-extension-autozod)
[![CI](https://github.com/abzr0o/prisma-extension-autozod/actions/workflows/ci.yml/badge.svg)](https://github.com/abzr0o/prisma-extension-autozod/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> Contract-aware compile-time linting, automatic schema generation, and runtime Zod validation for the new Prisma ORM (@prisma/orm-postgres).

`prisma-extension-autozod` connects **Zod 4** and **Prisma ORM 8**. It provides three layers of safety:

1. **Automatic Schema Inference**: Generate complete insert and update Zod schemas directly from `contract.json` without drifting field definitions.
2. **Compile-time Linting**: TypeScript flags any field in your Zod schema that does not exist in your Prisma data contract.
3. **Runtime Middleware**: Automatically intercepts write operations (`create`, `update`, `insert`) via Prisma 8's `beforeCompile` AST hook, maps domain fields to storage columns, sanitizes payloads, and writes back validated transforms, coercions, and defaults directly into database query parameters.

---

## Why prisma-extension-autozod?

| Feature | Manual Controller Validation | Schema Generators (zod-prisma) | prisma-extension-autozod |
| :--- | :--- | :--- | :--- |
| **Zero Controller Boilerplate** | No (Manual `.parse()`) | No (Manual `.parse()`) | Yes (Auto-intercepted) |
| **Prisma 8 Native Architecture** | No | No | Yes (`beforeCompile` / Contract) |
| **Direct Schema Inference** | No | Yes (Build step) | Yes (`createInsertSchema(contract, "User")`) |
| **Compile-Time Typo Linter** | No | No | Yes (Immediate IDE feedback) |
| **Casing & Column Mapping** | No | No | Yes (`first_name` <-> `firstName`) |
| **AST Value Write-Back** | No | No | Yes (Transforms and defaults reach DB) |

---

## Requirements

- **Node.js**: `>= 22.0.0`
- **Prisma ORM**: `@prisma/orm-postgres >= 8.0.0`
- **Zod**: `^4.0.0`

---

## Features

- **Direct Contract Schema Inference**: Infer base Zod schemas straight from your Prisma 8 `contract.json` via `createInsertSchema` and `createUpdateSchema`, with database defaults automatically made optional.
- **AST Transform & Default Write-Back**: Transformed and coerced values (e.g. `.trim().toLowerCase()`, `z.coerce.date()`, `.default()`) are updated in-place on AST parameter references so they actually persist to PostgreSQL.
- **Multi-Row Insert Protection**: Transparently handles ORM-generated `DefaultValueExpr` nodes in multi-row inserts without triggering false validation rejections.
- **Bidirectional Column & Model Mapping**: Seamlessly resolves domain model names to physical storage tables (e.g. `User` -> `users`) and model field names to storage columns (e.g. `firstName` -> `first_name`).
- **Compile-Time Contract Linting**: Catches schema mismatches and invalid fields at build-time with clear TypeScript diagnostics.
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

### 1. Infer Schemas Directly from contract.json (Recommended)

Generate complete Zod schemas with zero manual field maintenance and customize individual fields with refinements:

```typescript
import { createInsertSchema, createUpdateSchema } from "prisma-extension-autozod";
import contractJson from "./contract.json" with { type: "json" };

// Inferred from contract.json with defaults (e.g. id, createdAt) marked optional:
export const userCreateSchema = createInsertSchema(contractJson, "User", {
  email: (s) => s.email("Must be a valid email").toLowerCase().trim(),
  name: (s) => s.min(2),
});

// Update schema with all fields partial:
export const userUpdateSchema = createUpdateSchema(contractJson, "User");
```

---

### 2. Or Define Custom Schemas with Contract Linting

If you prefer authoring your schemas manually, bind them to your contract types using `createZodRegistry`:

```typescript
import { z } from "zod";
import { createZodRegistry } from "prisma-extension-autozod";
import type { models } from "./contract.d.ts";

const defineModel = createZodRegistry<typeof models.public>();

export const userValidator = defineModel(
  "User",
  z.object({
    email: z.string().email(),
    username: z.string().min(2).nullable().optional(),
    name: z.string().min(2).nullable().optional(),
  }),
);
```

> **Compile-Time Typo Protection:**
> If you add a field that does not exist in the contract:
> ```typescript
> defineModel("User", z.object({
>   nonExistentColumn: z.string(), // Error: Field 'nonExistentColumn' does not exist in table contract
> }));
> ```

---

### 3. Register Middleware in Your Prisma 8 Client

Pass the middleware to your `@prisma/orm-postgres` client setup:

```typescript
import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import { autoZodPrisma8 } from "prisma-extension-autozod";

import contractJson from "./contract.json" with { type: "json" };
import { userCreateSchema } from "./schemas.ts";

export const contract = contractFromJson(contractJson);

export const db = postgres({
  contract,
  url: process.env.DATABASE_URL!,
  middleware: [
    autoZodPrisma8({
      contract: contractJson,
      validators: [userCreateSchema],
    }),
  ],
});
```

---

### 4. Automatic Validation & Transform Write-Back

In the new Prisma ORM, models are accessed via `db.orm.<namespace>.<ModelName>`:

```typescript
// Valid: Passes validation, applies transforms, and executes
await db.orm.public.User.create({
  email: "  Alice@Prisma.IO  ", // Written back as "alice@prisma.io" in database
  username: "alice",
  name: "Alice Smith",
});

// Invalid: Throws standard ZodError before hitting PostgreSQL
await db.orm.public.User.create({
  email: "not-an-email",
  username: "a", // too short (< 2 characters)
  name: "Alice",
});

// Update: Only supplied fields are validated
await db.orm.public.User.where({ email: "alice@prisma.io" }).update({
  name: "Alice Wonder", // Valid; omitted fields are ignored on updates
});
```

---

### 5. Safe Route Validation (Mass Assignment Protection)

Never pass raw client input (`req.body`) directly to database writes. In web applications, unvalidated payloads allow clients to inject unauthorized columns (such as `role: 'admin'`, `emailVerified: true`, or `ownerId`).

The recommended, secure pattern is to parse `req.body` at your route handler, which strips unauthorized fields, while `autoZodPrisma8` provides an automatic database-layer guard rail:

```typescript
import { ZodError } from "zod";
import { userCreateSchema } from "./schemas.ts";

// Express / NestJS / Fastify / Hono route handler:
app.post("/users", async (req, res) => {
  try {
    // 1. Safe route validation: strips unknown fields & prevents mass assignment
    const validatedData = userCreateSchema.parse(req.body);

    // 2. Database mutation: intercepted & verified by AutoZod middleware
    const user = await db.orm.public.User.create(validatedData);
    return res.status(201).json(user);
  } catch (error) {
    if (error instanceof ZodError) {
      // Return clean, flattened validation errors directly to the client
      return res.status(400).json({ errors: error.flatten().fieldErrors });
    }
    return res.status(500).json({ error: "Internal server error" });
  }
});
```

---

### 6. Storage Column & Casing Normalization

If your Prisma contract maps camelCase model fields to snake_case storage columns (e.g. `@map("first_name")`), or if incoming payloads use alternative casing, `autoZodPrisma8` transparently reconciles them:

```typescript
// Model has firstName with @map("first_name"):
// Middleware automatically resolves `first_name` in AST rows to the `firstName` schema
await db.orm.public.User.create({
  first_name: "Alice",
  email: "alice@prisma.io",
});
```

---

## API Reference

### `createInsertSchema(contract, modelName, refinements?)`

Infers a complete Zod insert schema from `contract.json`. Fields with database defaults (`autoincrement()`, `now()`) are marked optional.
```typescript
const userCreateSchema = createInsertSchema(contractJson, "User", {
  email: (s) => s.email(),
});
```

### `createUpdateSchema(contract, modelName, refinements?)`

Infers a partial Zod update schema from `contract.json`.
```typescript
const userUpdateSchema = createUpdateSchema(contractJson, "User");
```

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
- `options.contract`: The parsed `contract.json` object.
- `options.validators`: Array of validator entries returned by `createInsertSchema`, `createZodRegistry`, or `createStrictZodRegistry`.

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
