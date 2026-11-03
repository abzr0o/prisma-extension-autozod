import { db } from "./prisma/db.ts";

async function main() {
  console.log("Testing Prisma 8 with prisma-extension-autozod...");

  // 1. Valid user creation (passes Zod validation)
  console.log("\n1. Testing valid insert:");
  try {
    const user = await db.orm.public.User.create({
      email: "alice@prisma.io",
      username: "alice",
      name: "Alice Smith",
    });
    console.log("Success: User created:", user);
  } catch (error) {
    console.error("Unexpected error on valid insert:", error);
  }

  // 2. Invalid user creation (rejected by Zod before reaching PostgreSQL)
  console.log("\n2. Testing invalid insert (invalid email and short username):");
  try {
    await db.orm.public.User.create({
      email: "not-an-email",
      username: "a", // schema requires min 2 characters
      name: "Alice",
    });
    console.error("Failure: Mutation should have been blocked by AutoZod!");
  } catch (error: any) {
    console.log("Success: Mutation correctly blocked by AutoZod ZodError:");
    if (error?.errors) {
      console.log(error.errors);
    } else {
      console.log(error.message ?? error);
    }
  }

  // 3. Partial update validation
  console.log("\n3. Testing partial update:");
  try {
    const updated = await db.orm.public.User.where({ email: "alice@prisma.io" }).update({
      name: "Alice Wonder", // Valid: updating only name
    });
    console.log("Success: Partial update executed:", updated);
  } catch (error) {
    console.error("Unexpected error on update:", error);
  }
}

main().catch(console.error);
