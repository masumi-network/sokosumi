import {
  betterAuthUserAdditionalFields,
  EMAIL_CODE_SIGN_IN_METHODS_REMOVED,
} from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { emailOTP } from "better-auth/plugins/email-otp";
import { describe, expect, it } from "vitest";

import { emailCodeSignIn } from "./auth-email-code-sign-in.js";
import { resolveEmailCodeSignInNameBody } from "./auth-user-name.js";

type Row = Record<string, unknown>;

function userRow(
  id: string,
  email: string,
  emailVerified: boolean,
  termsAccepted = true,
): Row {
  return {
    id,
    email,
    name: "",
    emailVerified,
    termsAccepted,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function passwordAccountRow(userId: string, password: string): Row {
  return {
    id: `credential-${userId}`,
    userId,
    providerId: "credential",
    accountId: userId,
    password,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function googleAccountRow(userId: string): Row {
  return {
    id: `google-${userId}`,
    userId,
    providerId: "google",
    accountId: `google-${userId}`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

// A real Better Auth instance with the email code plugin and Core's name hook,
// so the plugin runs where Core runs it: around Better Auth's own endpoint.
async function createTestAuth(
  seed: { user?: Row[]; account?: Row[] } = {},
  /** Runs after the plugin's before hook, ahead of Better Auth's endpoint. */
  meanwhile?: (db: Record<string, Row[]>) => void,
  refuseCredential?: () => boolean,
) {
  const codes = new Map<string, string>();
  // Read through `db`: the adapter swaps the arrays when a transaction commits.
  const db: Record<string, Row[]> = {
    user: seed.user ?? [],
    session: [],
    account: [],
    verification: [],
  };
  const auth = betterAuth({
    baseURL: "https://auth.example.com",
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    emailAndPassword: { enabled: true, minPasswordLength: 8 },
    user: { additionalFields: betterAuthUserAdditionalFields },
    databaseHooks: {
      account: {
        create: {
          before: async (account) => {
            if (account.providerId === "credential" && refuseCredential?.()) {
              throw new APIError("INTERNAL_SERVER_ERROR", {
                message: "Credential write failed",
              });
            }
          },
        },
      },
    },
    plugins: [
      emailCodeSignIn(
        emailOTP({
          storeOTP: "encrypted",
          allowedAttempts: 5,
          resendStrategy: "reuse",
          sendVerificationOTP: async ({ email, otp }) => {
            codes.set(email, otp);
          },
        }),
      ),
      {
        id: "meanwhile",
        hooks: {
          before: [
            {
              matcher: (ctx) => ctx.path === "/sign-in/email-otp",
              handler: createAuthMiddleware(async () => meanwhile?.(db)),
            },
          ],
        },
      },
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email-otp") {
          return {
            context: { body: resolveEmailCodeSignInNameBody(ctx.body) },
          };
        }
      }),
      // Core's terms check, which runs before plugin after hooks.
      after: createAuthMiddleware(async (ctx) => {
        const user = ctx.context.newSession?.user;
        if (user && !user.termsAccepted) {
          throw new APIError("BAD_REQUEST", { code: "TERMS_NOT_ACCEPTED" });
        }
      }),
    },
    rateLimit: { enabled: false },
  });
  // Hashed by the instance itself, so password sign-in can check it.
  const context = await auth.$context;
  for (const account of seed.account ?? []) {
    db.account?.push({
      ...account,
      ...(typeof account.password === "string"
        ? { password: await context.password.hash(account.password) }
        : {}),
    });
  }

  function post(path: string, body: Row) {
    return auth.handler(
      new Request(`https://auth.example.com/auth${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }
  async function sendCode(email: string) {
    await post("/email-otp/send-verification-otp", { email, type: "sign-in" });
    return codes.get(email) ?? "";
  }
  return {
    db,
    post,
    sendCode,
    signInWithCode: (body: Row) => post("/sign-in/email-otp", body),
    signInWithPassword: (email: string, password: string) =>
      post("/sign-in/email", { email, password }),
  };
}

const SIGN_UP = {
  firstName: "Ada",
  lastName: "Lovelace",
  termsAccepted: true,
  marketingOptIn: false,
};

describe("password sign-up through an email code", () => {
  it("creates a verified account that then signs in with the password", async () => {
    const auth = await createTestAuth();
    const otp = await auth.sendCode("ada@example.com");

    const signUp = await auth.signInWithCode({
      email: "ada@example.com",
      otp,
      password: "correct horse battery",
      ...SIGN_UP,
    });

    expect(signUp.status).toBe(200);
    expect(auth.db.user).toEqual([
      expect.objectContaining({
        email: "ada@example.com",
        emailVerified: true,
        name: "Ada Lovelace",
      }),
    ]);
    expect(
      (
        await auth.signInWithPassword(
          "ada@example.com",
          "correct horse battery",
        )
      ).status,
    ).toBe(200);
  });

  it("refuses an address that has an account, and leaves the code unused", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", true)],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signUp = await auth.signInWithCode({
      email: "ada@example.com",
      otp,
      password: "correct horse battery",
      ...SIGN_UP,
    });

    expect(signUp.status).toBe(422);
    expect(await signUp.json()).toMatchObject({
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    });
    expect(auth.db.account).toEqual([]);
    // The person can still sign in with that code.
    expect(
      (await auth.signInWithCode({ email: "ada@example.com", otp })).status,
    ).toBe(200);
  });

  // e.g. the person signed up with Google in another tab meanwhile.
  it("refuses an account that appeared since the check without spending the code", async () => {
    const auth = await createTestAuth({}, (db) => {
      db.user?.push(userRow("user-1", "ada@example.com", true));
      db.account?.push(googleAccountRow("user-1"));
    });
    const otp = await auth.sendCode("ada@example.com");

    const signUp = await auth.signInWithCode({
      email: "ada@example.com",
      otp,
      password: "correct horse battery",
      ...SIGN_UP,
    });

    expect(signUp.status).toBe(422);
    expect(await signUp.json()).toMatchObject({
      code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
    });
    expect(auth.db.session).toEqual([]);
    expect(auth.db.account).toEqual([
      expect.objectContaining({ providerId: "google" }),
    ]);
    expect(auth.db.verification).toHaveLength(1);
  });

  it("rolls back user, session and OTP consumption when the credential write fails", async () => {
    let fail = true;
    const auth = await createTestAuth({}, undefined, () => fail);
    const otp = await auth.sendCode("ada@example.com");
    const body = {
      email: "ada@example.com",
      otp,
      password: "correct horse battery",
      ...SIGN_UP,
    };

    const refused = await auth.signInWithCode(body);

    expect(refused.status).toBe(500);
    expect(auth.db.user).toEqual([]);
    expect(auth.db.account).toEqual([]);
    expect(auth.db.session).toEqual([]);
    expect(refused.headers.getSetCookie()).toEqual([]);
    fail = false;
    expect((await auth.signInWithCode(body)).status).toBe(200);
    expect(
      (await auth.signInWithPassword(body.email, body.password)).status,
    ).toBe(200);
  });

  it("keeps wrong-code attempt limits when password signup runs in a transaction", async () => {
    const auth = await createTestAuth();
    const otp = await auth.sendCode("ada@example.com");
    const body = {
      email: "ada@example.com",
      otp: otp === "000000" ? "111111" : "000000",
      password: "correct horse battery",
      ...SIGN_UP,
    };

    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await auth.signInWithCode(body);
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "INVALID_OTP" });
    }
    const locked = await auth.signInWithCode({ ...body, otp });
    expect(locked.status).toBe(403);
    expect(await locked.json()).toMatchObject({ code: "TOO_MANY_ATTEMPTS" });
    expect(auth.db.user).toEqual([]);
    expect(auth.db.session).toEqual([]);
  });

  it.each([
    ["too short", "short", "PASSWORD_TOO_SHORT"],
    ["too long", "x".repeat(129), "PASSWORD_TOO_LONG"],
  ])(
    "refuses a password that is %s before using the code",
    async (_label, password, code) => {
      const auth = await createTestAuth();
      const otp = await auth.sendCode("ada@example.com");

      const signUp = await auth.signInWithCode({
        email: "ada@example.com",
        otp,
        password,
        ...SIGN_UP,
      });

      expect(signUp.status).toBe(400);
      expect(await signUp.json()).toMatchObject({ code });
      expect(auth.db.user).toEqual([]);
      expect(
        (
          await auth.signInWithCode({
            email: "ada@example.com",
            otp,
            password: "correct horse battery",
            ...SIGN_UP,
          })
        ).status,
      ).toBe(200);
    },
  );
});

describe("code sign-in to an account whose address is unproven", () => {
  it("says the password and provider links were removed", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", false)],
      account: [
        passwordAccountRow("user-1", "correct horse battery"),
        googleAccountRow("user-1"),
      ],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signIn = await auth.signInWithCode({ email: "ada@example.com", otp });

    expect(signIn.status).toBe(200);
    expect(await signIn.json()).toMatchObject({
      [EMAIL_CODE_SIGN_IN_METHODS_REMOVED]: true,
    });
    // Better Auth's protection still runs.
    expect(auth.db.account).toEqual([]);
  });

  it("says nothing when the account had no other way in", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", false)],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signIn = await auth.signInWithCode({ email: "ada@example.com", otp });

    expect(signIn.status).toBe(200);
    expect(await signIn.json()).not.toHaveProperty(
      EMAIL_CODE_SIGN_IN_METHODS_REMOVED,
    );
  });

  it("says nothing, and removes nothing, when the code is wrong", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", false)],
      account: [passwordAccountRow("user-1", "correct horse battery")],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signIn = await auth.signInWithCode({
      email: "ada@example.com",
      otp: otp === "000000" ? "111111" : "000000",
    });

    expect(signIn.status).toBe(400);
    expect(await signIn.json()).not.toHaveProperty(
      EMAIL_CODE_SIGN_IN_METHODS_REMOVED,
    );
    expect(auth.db.account).toHaveLength(1);
  });
});

describe("code sign-in refused after the code was accepted", () => {
  it("stays refused, without the removal notice", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", false, false)],
      account: [passwordAccountRow("user-1", "correct horse battery")],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signIn = await auth.signInWithCode({ email: "ada@example.com", otp });

    expect(signIn.status).toBe(400);
    const body = await signIn.json();
    expect(body).toMatchObject({ code: "TERMS_NOT_ACCEPTED" });
    expect(body).not.toHaveProperty(EMAIL_CODE_SIGN_IN_METHODS_REMOVED);
  });
});

describe("code sign-in to a verified account", () => {
  it("keeps the password and says nothing", async () => {
    const auth = await createTestAuth({
      user: [userRow("user-1", "ada@example.com", true)],
      account: [passwordAccountRow("user-1", "correct horse battery")],
    });
    const otp = await auth.sendCode("ada@example.com");

    const signIn = await auth.signInWithCode({ email: "ada@example.com", otp });

    expect(signIn.status).toBe(200);
    expect(await signIn.json()).not.toHaveProperty(
      EMAIL_CODE_SIGN_IN_METHODS_REMOVED,
    );
    expect(
      (
        await auth.signInWithPassword(
          "ada@example.com",
          "correct horse battery",
        )
      ).status,
    ).toBe(200);
  });
});
