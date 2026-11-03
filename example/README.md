# prisma-extension-autozod Example

Minimal example demonstrating compile-time linting and runtime Zod validation for Prisma ORM 8 (`@prisma/orm-postgres`).

## Structure

- `src/prisma/contract.prisma`: Database contract models (User, Post).
- `src/prisma/schemas.ts`: Zod validation schemas bound to the Prisma 8 contract via `createZodRegistry`.
- `src/prisma/db.ts`: Prisma 8 client configured with `autoZodPrisma8` middleware.
- `src/index.ts`: Executable test script running valid and invalid mutations.

## Getting Started

1. Set your PostgreSQL database connection URL in `.env`:
   ```bash
   DATABASE_URL="postgresql://user:password@localhost:5432/mydb"
   ```

2. Typecheck the schemas and client:
   ```bash
   npm run typecheck
   ```

3. Run the demonstration script:
   ```bash
   npm start
   ```
