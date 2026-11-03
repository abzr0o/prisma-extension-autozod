import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  autoZodPrisma8,
  autoZod,
  createZodRegistry,
  createStrictZodRegistry,
  extractColumns,
  normalizeKey,
} from "../src/index.js";

describe("prisma-extension-autozod", () => {
  const sampleContract = {
    storage: {
      namespaces: {
        public: {
          tables: {
            users: {
              columns: {
                id: { type: "int" },
                firstName: { type: "text" },
                email: { type: "text" },
                age: { type: "int" },
              },
            },
            posts: {
              columns: {
                id: { type: "int" },
                title: { type: "text" },
              },
            },
          },
        },
      },
    },
  };

  describe("normalizeKey", () => {
    it("should lowercase and strip non-alphanumeric characters", () => {
      expect(normalizeKey("User_Profiles")).toBe("userprofiles");
      expect(normalizeKey("first-name")).toBe("firstname");
      expect(normalizeKey("USERS")).toBe("users");
    });
  });

  describe("extractColumns", () => {
    it("should extract normalized table columns from contract.json", () => {
      const catalog = extractColumns(sampleContract);
      expect(catalog["users"]).toEqual(["id", "firstName", "email", "age"]);
      expect(catalog["posts"]).toEqual(["id", "title"]);
    });

    it("should handle empty or missing contract structure gracefully", () => {
      expect(extractColumns({})).toEqual({});
      expect(extractColumns(null)).toEqual({});
    });
  });

  describe("createZodRegistry", () => {
    type TestModels = {
      users: { id: number; firstName: string; email: string; age: number };
      posts: { id: number; title: string };
    };

    it("should construct typed validator entries", () => {
      const defineModel = createZodRegistry<TestModels>();
      const userValidator = defineModel(
        "users",
        z.object({
          firstName: z.string().min(2),
          email: z.string().email(),
          age: z.number().int().min(18),
        })
      );

      expect(userValidator.tableName).toBe("users");
      expect(userValidator.schema).toBeDefined();
    });

    it("should reject non-existent contract fields at compile time", () => {
      const defineModel = createZodRegistry<TestModels>();
      // @ts-expect-error nonExistentField is not in the contract
      defineModel(
        "users",
        z.object({
          firstName: z.string(),
          nonExistentField: z.string(),
        })
      );
    });
  });

  describe("createStrictZodRegistry", () => {
    type TestModels = {
      users: { id: number; firstName: string; email: string; age: number };
    };

    it("should accept schema when all contract columns are present", () => {
      const defineModel = createStrictZodRegistry<TestModels>();
      const userValidator = defineModel(
        "users",
        z.object({
          id: z.number(),
          firstName: z.string(),
          email: z.string(),
          age: z.number(),
        })
      );
      expect(userValidator.tableName).toBe("users");
    });

    it("should reject schema when required contract columns are missing", () => {
      const defineModel = createStrictZodRegistry<TestModels>();
      // @ts-expect-error missing id, email, and age
      defineModel(
        "users",
        z.object({
          firstName: z.string(),
        })
      );
    });
  });

  describe("autoZodPrisma8 Middleware", () => {
    const defineValidator = createZodRegistry();
    const userValidator = defineValidator(
      "users",
      z.object({
        firstName: z.string().min(2),
        email: z.string().email(),
        age: z.number().int().min(18),
      })
    );

    const middleware = autoZodPrisma8({
      contract: sampleContract,
      validators: [userValidator],
    });

    it("should pass valid create mutation", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              firstName: "Alice",
              email: "alice@example.com",
              age: 25,
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should pass valid create mutation with ParamRef wrapped values", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              firstName: { value: "Alice" },
              email: { value: "alice@example.com" },
              age: { value: 25 },
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should reject invalid create mutation with ZodError", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              firstName: "A", // too short (< 2)
              email: "invalid-email",
              age: 15, // under 18
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should allow partial update mutation missing non-updated fields", async () => {
      const draft = {
        ast: {
          kind: "update",
          table: { name: "users" },
          set: {
            age: 30, // only updating age, firstName and email are omitted
          },
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should reject invalid field in update mutation", async () => {
      const draft = {
        ast: {
          kind: "update",
          table: { name: "users" },
          set: {
            email: "not-an-email",
          },
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should remap casing/naming matching contract columns", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              first_name: "Bob", // will be remapped to firstName
              email: "bob@example.com",
              age: 40,
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should validate batch insert arrays", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            { firstName: "Charlie", email: "charlie@example.com", age: 22 },
            { firstName: "Dave", email: "dave@example.com", age: 16 }, // under 18
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should ignore unmapped models", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "posts" },
          rows: [
            {
              unregisteredField: "any value",
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should ignore non-insert/update drafts", async () => {
      const draft = {
        ast: {
          kind: "select",
          table: { name: "users" },
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should ignore draft without ast", async () => {
      await expect(
        middleware.beforeCompile!({} as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should provide autoZod alias identical to autoZodPrisma8", () => {
      expect(autoZod).toBe(autoZodPrisma8);
    });
  });
});
