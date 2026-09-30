import { betterAuthUserAdditionalFields } from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { magicLink } from "better-auth/plugins/magic-link";
import { describe, expect, it } from "vitest";

import {
  resolveSignUpNameBody,
  validateUpdatedUserName,
  validateUserNameLength,
} from "./auth-user-name.js";

// A real Better Auth instance: the point is that the before hook runs ahead of
// the endpoint's own body validation, which still requires `name`.
function createTestAuth() {
  let magicLinkUrl = "";
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
    session: { cookieCache: { enabled: true } },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            validateUserNameLength(user.firstName, user.lastName);
            return { data: user };
          },
        },
      },
    },
    plugins: [
      magicLink({
        sendMagicLink: async ({ url }) => {
          magicLinkUrl = url;
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          return { context: { body: resolveSignUpNameBody(ctx.body) } };
        }
        if (ctx.path === "/update-user") {
          await validateUpdatedUserName(ctx);
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
  async function signInWithMagicLink() {
    await auth.handler(
      new Request("https://auth.example.com/auth/sign-in/magic-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      }),
    );
    return auth.handler(new Request(magicLinkUrl));
  }
  async function updateUser(body: Record<string, unknown>, response: Response) {
    const cookie = response.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    return auth.handler(
      new Request("https://auth.example.com/auth/update-user", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://auth.example.com",
          cookie,
        },
        body: JSON.stringify(body),
      }),
    );
  }
  return { signUp, signInWithMagicLink, updateUser, db };
}

describe("email sign-up name", () => {
  it("stores no name parts for a new Magic Link account", async () => {
    const { signInWithMagicLink, db } = createTestAuth();

    const response = await signInWithMagicLink();

    expect(response.status).toBe(302);
    expect(db.user[0]).toMatchObject({
      name: "",
      firstName: null,
      lastName: null,
    });
  });

  it("leaves a legacy user's null parts and chosen display name untouched on sign-in", async () => {
    const { signInWithMagicLink, db } = createTestAuth();
    db.user.push({
      id: "legacy-user",
      email: "ada@example.com",
      emailVerified: true,
      name: "Countess of Lovelace",
      firstName: null,
      lastName: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await signInWithMagicLink();

    expect(response.status).toBe(302);
    expect(db.user[0]).toMatchObject({
      name: "Countess of Lovelace",
      firstName: null,
      lastName: null,
    });
  });

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

  it("normalizes updated name parts without changing the display name", async () => {
    const { signUp, updateUser, db } = createTestAuth();
    const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });

    const response = await updateUser(
      { firstName: "  Augusta  ", lastName: "  Byron  " },
      session,
    );

    expect(response.status).toBe(200);
    expect(db.user[0]).toMatchObject({
      firstName: "Augusta",
      lastName: "Byron",
      name: "Ada Lovelace",
    });
  });

  it.each([
    { firstName: "a".repeat(100), lastName: "b".repeat(27) },
    { firstName: "a".repeat(27), lastName: "b".repeat(100) },
  ])("accepts a 128-character combined name: %o", async (body) => {
    const { signUp, db } = createTestAuth();

    const response = await signUp(body);

    expect(response.status).toBe(200);
    expect(db.user[0]?.name).toHaveLength(128);
  });

  it("rejects a 129-character combined name before creating a user", async () => {
    const { signUp, db } = createTestAuth();

    const response = await signUp({
      firstName: "a".repeat(64),
      lastName: "b".repeat(64),
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NAME_TOO_LONG" });
    expect(db.user).toHaveLength(0);
  });

  it("accepts a trimmed partial update at the combined boundary", async () => {
    const { signUp, updateUser, db } = createTestAuth();
    const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });

    const response = await updateUser(
      { firstName: `  ${"a".repeat(119)}  ` },
      session,
    );

    expect(response.status).toBe(200);
    expect(db.user[0]).toMatchObject({
      firstName: "a".repeat(119),
      lastName: "Lovelace",
      name: "Ada Lovelace",
    });
  });

  it("uses the stored counterpart when validating a partial update", async () => {
    const { signUp, updateUser, db } = createTestAuth();
    const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });

    const response = await updateUser({ firstName: "a".repeat(120) }, session);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NAME_TOO_LONG" });
    expect(db.user[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("uses current stored names even when the cookie cache is stale", async () => {
    const { signUp, updateUser, db } = createTestAuth();
    const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });
    const updated = await updateUser({ lastName: "b".repeat(100) }, session);
    expect(updated.status).toBe(200);

    const response = await updateUser({ firstName: "a".repeat(28) }, session);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NAME_TOO_LONG" });
    expect(db.user[0]).toMatchObject({
      firstName: "Ada",
      lastName: "b".repeat(100),
    });
  });

  it("rejects an overlong update of both name parts", async () => {
    const { signUp, updateUser, db } = createTestAuth();
    const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });

    const response = await updateUser(
      {
        firstName: "a".repeat(64),
        lastName: "b".repeat(64),
      },
      session,
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "NAME_TOO_LONG" });
    expect(db.user[0]).toMatchObject({
      firstName: "Ada",
      lastName: "Lovelace",
    });
  });

  it("accepts onboarding a Magic Link user with names over the old individual cap", async () => {
    const { signInWithMagicLink, updateUser, db } = createTestAuth();
    const session = await signInWithMagicLink();

    const response = await updateUser(
      {
        firstName: "a".repeat(100),
        lastName: "b".repeat(27),
        name: `${"a".repeat(100)} ${"b".repeat(27)}`,
      },
      session,
    );

    expect(response.status).toBe(200);
    expect(db.user[0]).toMatchObject({
      firstName: "a".repeat(100),
      lastName: "b".repeat(27),
    });
    expect(db.user[0]?.name).toHaveLength(128);
  });

  it.each(["", "   ", 7])(
    "rejects an invalid name part at the update endpoint: %j",
    async (firstName) => {
      const { signUp, updateUser, db } = createTestAuth();
      const session = await signUp({ firstName: "Ada", lastName: "Lovelace" });

      const response = await updateUser({ firstName }, session);

      expect(response.status).toBe(400);
      expect(db.user[0]).toMatchObject({
        firstName: "Ada",
        lastName: "Lovelace",
      });
    },
  );
});
