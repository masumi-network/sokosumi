import { betterAuthUserAdditionalFields } from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { describe, expect, it } from "vitest";

import { resolveSignUpNameBody } from "./auth-sign-up-name.js";

// A real Better Auth instance: the point is that the before hook runs ahead of
// the endpoint's own body validation, which still requires `name`.
function createTestAuth() {
  // Read through `db`: the adapter swaps the arrays when a transaction commits.
  const db: Record<string, Array<Record<string, unknown>>> = {
    user: [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true },
    user: { additionalFields: betterAuthUserAdditionalFields },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          return { context: { body: resolveSignUpNameBody(ctx.body) } };
        }
      }),
    },
    rateLimit: { enabled: false },
  });
  function signUp(body: Record<string, unknown>) {
    return auth.handler(
      new Request("https://auth.example.com/auth/sign-up/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "ada@example.com",
          password: "Password123!",
          ...body,
        }),
      }),
    );
  }
  return { signUp, db };
}

describe("email sign-up name", () => {
  it("derives the display name from first and last name", async () => {
    const { signUp, db } = createTestAuth();

    const response = await signUp({ firstName: " Ada ", lastName: "Lovelace" });

    expect(response.status).toBe(200);
    expect(db.user).toHaveLength(1);
    expect(db.user[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
      name: "Ada Lovelace",
    });
  });

  it("ignores a name the client sent", async () => {
    const { signUp, db } = createTestAuth();

    await signUp({ firstName: "Ada", lastName: "Lovelace", name: "Someone" });

    expect(db.user[0]).toMatchObject({ name: "Ada Lovelace" });
  });

  it.each([
    { firstName: "Ada" },
    { lastName: "Lovelace" },
    { firstName: "Ada", lastName: "   " },
    { firstName: 1, lastName: "Lovelace" },
    { name: "Ada Lovelace" },
  ])("rejects a sign-up without both name parts: %o", async (body) => {
    const { signUp, db } = createTestAuth();

    const response = await signUp(body);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NAME_REQUIRED" });
    expect(db.user).toHaveLength(0);
  });
});
