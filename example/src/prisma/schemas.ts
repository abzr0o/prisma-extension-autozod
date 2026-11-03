import { z } from "zod";
import { createZodRegistry } from "prisma-extension-autozod";
import type { models } from "./contract.d.ts";

const defineModel = createZodRegistry<typeof models.public>();

export const userValidator = defineModel(
  "User",
  z.object({
    email: z.string().email("Invalid email address"),
    username: z.string().min(2, "Username must be at least 2 characters").nullable().optional(),
    name: z.string().min(2, "Name must be at least 2 characters").nullable().optional(),
  })
);

export const postValidator = defineModel(
  "Post",
  z.object({
    title: z.string().min(3, "Title must have at least 3 characters"),
    content: z.string().nullable().optional(),
    authorId: z.number().int().positive(),
  })
);

export const validators = [userValidator, postValidator];

