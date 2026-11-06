import { z } from "zod";
import { createZodRegistry, createInsertSchema } from "prisma-extension-autozod";
import type { models } from "./contract.d.ts";
import contractJson from "./contract.json" with { type: "json" };

const defineModel = createZodRegistry<typeof models.public>();

export const userValidator = defineModel(
  "User",
  z.object({
    email: z.string().email("Invalid email address"),
    username: z.string().min(2, "Username must be at least 2 characters").nullable().optional(),
    name: z.string().min(2, "Name must be at least 2 characters").nullable().optional(),
  })
);

// Inferred directly from contract.json without drift:
export const postValidator = createInsertSchema(contractJson, "Post", {
  title: (s) => s.min(3, "Title must have at least 3 characters"),
});

export const validators = [userValidator, postValidator];
