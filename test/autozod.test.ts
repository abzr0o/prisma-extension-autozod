import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  autoZodPrisma8,
  autoZod,
  createZodRegistry,
  createStrictZodRegistry,
  createInsertSchema,
  createUpdateSchema,
  extractColumns,
  extractContractMetadata,
  isDefaultValueExpr,
  normalizeKey,
} from "../src/index.js";

describe("prisma-extension-autozod", () => {
  // Complete sample contract matching Prisma ORM 8 contract.json structure
  const sampleContract = {
    domain: {
      namespaces: {
        public: {
          models: {
            User: {
              fields: {
                id: {
                  nullable: false,
                  type: { codecId: "pg/int4@1", kind: "scalar" },
                },
                firstName: {
                  nullable: false,
                  type: { codecId: "pg/text@1", kind: "scalar" },
                },
                email: {
                  nullable: false,
                  type: { codecId: "pg/text@1", kind: "scalar" },
                },
                age: {
                  nullable: false,
                  type: { codecId: "pg/int4@1", kind: "scalar" },
                },
              },
              storage: {
                namespaceId: "public",
                table: "users", // Storage table "users" != Domain model "User"
                fields: {
                  id: { column: "id" },
                  firstName: { column: "first_name" }, // Model "firstName" -> Storage "first_name"
                  email: { column: "email" },
                  age: { column: "age" },
                },
              },
            },
            Post: {
              fields: {
                id: {
                  nullable: false,
                  type: { codecId: "pg/int4@1", kind: "scalar" },
                },
                title: {
                  nullable: false,
                  type: { codecId: "pg/text@1", kind: "scalar" },
                },
              },
              storage: {
                namespaceId: "public",
                table: "posts",
                fields: {
                  id: { column: "id" },
                  title: { column: "title" },
                },
              },
            },
          },
        },
      },
    },
    storage: {
      namespaces: {
        public: {
          entries: {
            table: {
              users: {
                columns: {
                  id: {
                    default: {
                      expression: "autoincrement()",
                      kind: "function",
                    },
                    nullable: false,
                  },
                  first_name: { nullable: false },
                  email: { nullable: false },
                  age: { nullable: false },
                },
              },
              posts: {
                columns: {
                  id: {
                    default: {
                      expression: "autoincrement()",
                      kind: "function",
                    },
                    nullable: false,
                  },
                  title: { nullable: false },
                },
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

  describe("extractContractMetadata", () => {
    it("should extract bidirectional model and storage mappings", () => {
      const meta = extractContractMetadata(sampleContract);
      const userMeta = meta.modelsByName.get("user");
      expect(userMeta).toBeDefined();
      expect(userMeta?.storageTable).toBe("users");
      expect(userMeta?.modelFieldToColumn.get("firstname")).toBe("first_name");
      expect(userMeta?.columnToModelField.get("firstname")).toBe("firstName");
      expect(meta.modelsByTable.get("users")).toBe(userMeta);
    });
  });

  describe("extractColumns", () => {
    it("should extract normalized table columns from contract.json", () => {
      const catalog = extractColumns(sampleContract);
      expect(catalog["users"]).toEqual(["id", "first_name", "email", "age"]);
      expect(catalog["posts"]).toEqual(["id", "title"]);
    });

    it("should handle empty or missing contract structure gracefully", () => {
      expect(extractColumns({})).toEqual({});
      expect(extractColumns(null)).toEqual({});
    });
  });

  describe("createInsertSchema & createUpdateSchema", () => {
    it("should infer insert schema with defaults marked optional and custom refinements", () => {
      const userCreate = createInsertSchema(sampleContract, "User", {
        email: (s) => s.email("Invalid email"),
        firstName: (s) => s.min(2),
      });

      expect(userCreate.tableName).toBe("User");
      const shape = userCreate.shape;

      // id has default in storage, so it must be optional
      expect(shape.id.isOptional()).toBe(true);

      // Valid insert data
      const valid = userCreate.parse({
        firstName: "Alice",
        email: "alice@prisma.io",
        age: 25,
      });
      expect(valid.firstName).toBe("Alice");

      // Invalid email refinement should throw
      expect(() =>
        userCreate.parse({
          firstName: "Alice",
          email: "invalid-email",
          age: 25,
        })
      ).toThrow();
    });

    it("should generate partial update schema via createUpdateSchema", () => {
      const userUpdate = createUpdateSchema(sampleContract, "User");
      expect(userUpdate.tableName).toBe("User");

      // All fields should be optional for updates
      const valid = userUpdate.parse({
        age: 30,
      });
      expect(valid.age).toBe(30);
    });

    it("should throw a helpful error if model is not found in contract", () => {
      expect(() =>
        createInsertSchema(sampleContract, "NonExistentModel")
      ).toThrow(/not found in contract/);
    });
  });

  describe("createZodRegistry", () => {
    type TestModels = {
      User: { id: number; firstName: string; email: string; age: number };
      Post: { id: number; title: string };
    };

    it("should construct typed validator entries", () => {
      const defineModel = createZodRegistry<TestModels>();
      const userValidator = defineModel(
        "User",
        z.object({
          firstName: z.string().min(2),
          email: z.string().email(),
          age: z.number().int().min(18),
        })
      );

      expect(userValidator.tableName).toBe("User");
      expect(userValidator.schema).toBeDefined();
    });

    it("should reject non-existent contract fields at compile time", () => {
      const defineModel = createZodRegistry<TestModels>();
      // @ts-expect-error nonExistentField is not in the contract
      defineModel(
        "User",
        z.object({
          firstName: z.string(),
          nonExistentField: z.string(),
        })
      );
    });
  });

  describe("createStrictZodRegistry", () => {
    type TestModels = {
      User: { id: number; firstName: string; email: string; age: number };
    };

    it("should accept schema when all contract columns are present", () => {
      const defineModel = createStrictZodRegistry<TestModels>();
      const userValidator = defineModel(
        "User",
        z.object({
          id: z.number(),
          firstName: z.string(),
          email: z.string(),
          age: z.number(),
        })
      );
      expect(userValidator.tableName).toBe("User");
    });

    it("should reject schema when required contract columns are missing", () => {
      const defineModel = createStrictZodRegistry<TestModels>();
      // @ts-expect-error missing id, email, and age
      defineModel(
        "User",
        z.object({
          firstName: z.string(),
        })
      );
    });
  });

  describe("autoZodPrisma8 Middleware", () => {
    const defineValidator = createZodRegistry();
    const userValidator = defineValidator(
      "User", // Model name "User"
      z.object({
        firstName: z.string().min(2), // Schema uses domain field name
        email: z.string().trim().toLowerCase().email(),
        age: z.number().int().min(18),
      })
    );

    const middleware = autoZodPrisma8({
      contract: sampleContract,
      validators: [userValidator],
    });

    it("should map storage table 'users' to model 'User' and storage column 'first_name' to schema 'firstName'", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" }, // Storage table
          rows: [
            {
              first_name: { value: "Alice" }, // Storage column
              email: { value: "Alice@Example.com" },
              age: { value: 25 },
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should reject invalid mutation when using mapped storage column", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              first_name: { value: "A" }, // Invalid: min(2)
              email: { value: "alice@example.com" },
              age: { value: 25 },
            },
          ],
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should write back transformed and coerced values into ParamRef.value", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              first_name: { value: "Alice" },
              email: { value: "  ALICE@EXAMPLE.COM  " }, // Has whitespace and uppercase
              age: { value: 25 },
            },
          ],
        },
      };

      await middleware.beforeCompile!(draft as any, {} as any);

      // Verify that the transform (.trim().toLowerCase()) was written back into the AST ParamRef
      expect((draft.ast.rows[0].email as any).value).toBe("alice@example.com");
    });

    it("should handle DefaultValueExpr in multi-row inserts without failing Zod", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "users" },
          rows: [
            {
              first_name: { value: "Alice" },
              email: { value: "alice@example.com" },
              age: { value: 25 },
            },
            {
              first_name: { value: "Bob" },
              email: { value: "bob@example.com" },
              age: { kind: "default-value" }, // DefaultValueExpr node generated by ORM
            },
          ],
        },
      };

      // Even though age is required in full schema, DefaultValueExpr placeholder
      // indicates the DB should supply the default, so Zod ignores it for this row
      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should allow partial update mutation missing non-updated fields", async () => {
      const draft = {
        ast: {
          kind: "update",
          table: { name: "users" },
          set: {
            age: { value: 30 }, // Only updating age
          },
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).resolves.toBeUndefined();
    });

    it("should reject invalid field in update mutation on mapped storage column", async () => {
      const draft = {
        ast: {
          kind: "update",
          table: { name: "users" },
          set: {
            first_name: { value: "X" }, // Invalid (< 2)
          },
        },
      };

      await expect(
        middleware.beforeCompile!(draft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should support validators created with createInsertSchema directly", async () => {
      const postSchema = createInsertSchema(sampleContract, "Post", {
        title: (s) => s.min(3),
      });

      const customMiddleware = autoZodPrisma8({
        contract: sampleContract,
        validators: [postSchema],
      });

      const validDraft = {
        ast: {
          kind: "insert",
          table: { name: "posts" },
          rows: [
            {
              title: { value: "Hello World" },
            },
          ],
        },
      };

      await expect(
        customMiddleware.beforeCompile!(validDraft as any, {} as any)
      ).resolves.toBeUndefined();

      const invalidDraft = {
        ast: {
          kind: "insert",
          table: { name: "posts" },
          rows: [
            {
              title: { value: "No" }, // < 3 chars
            },
          ],
        },
      };

      await expect(
        customMiddleware.beforeCompile!(invalidDraft as any, {} as any)
      ).rejects.toThrow();
    });

    it("should ignore unmapped models", async () => {
      const draft = {
        ast: {
          kind: "insert",
          table: { name: "unmapped_table" },
          rows: [{ field: "any" }],
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

    it("should provide autoZod alias identical to autoZodPrisma8", () => {
      expect(autoZod).toBe(autoZodPrisma8);
    });
  });
});
