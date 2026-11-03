import postgres from "@prisma/orm-postgres/runtime";
import { contractFromJson } from "@prisma/orm-postgres/static";
import "temporal-polyfill/global";

import { autoZodPrisma8 } from "prisma-extension-autozod";
import type { Contract } from "./contract.d.ts";
import contractJson from "./contract.json" with { type: "json" };
import { validators } from "./schemas.ts";

export const contract = contractFromJson<Contract>(contractJson);

export const db = postgres({
  contract,
  url: process.env.DATABASE_URL || "postgresql://postgres:postgres@localhost:5432/mydb",
  middleware: [
    autoZodPrisma8({
      contract: contractJson,
      validators,
    }),
  ],
});
