// First: schemas built before this module loads have no `.openapi`, and the
// `/v1` router needs it on the ones `@sokosumi/utils` exports.
import "@hono/zod-openapi";

import { randomUUID } from "node:crypto";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import prisma from "@/lib/db/prisma";
import authRouter from "@/routes/auth/index";
import apiV1 from "@/routes/v1/index";

export const ORIGIN = "https://example.com";
const PASSWORD = "fixture-password-long";

/**
 * Core's `/auth` and `/v1` as `src/index.ts` mounts them, with the real auth
 * middleware and Better Auth, for PostgreSQL tests that send real credentials.
 * The test file mocks what a sign-in reaches outside the database
 * (`@/helpers/background-email`, Stripe, the account webhook).
 */
export function createCoreApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/auth", authRouter);
  app.route("/v1", apiV1);
  return app;
}

export async function createPasswordUser(name: string, role = "user") {
  const id = randomUUID();
  const email = `${id}@example.test`;
  await prisma.user.create({
    data: {
      id,
      name,
      email,
      role,
      emailVerified: true,
      termsAccepted: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await hashPassword(PASSWORD),
        },
      },
    },
  });
  return { id, email, name };
}

/**
 * The session token cookie alone. Without Better Auth's session cache cookie
 * every request reads the session and its user from the database. The last
 * one set: an impersonation clears the admin's cookie before it sets its own.
 */
export function sessionTokenCookie(response: Response): string {
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0] ?? "")
    .findLast((pair) => /session_token=.+/.test(pair));
  if (!cookie) throw new Error("The response set no session token cookie");
  return cookie;
}

/** Signs in with email and password through `/auth`. */
export async function signIn(
  app: ReturnType<typeof createCoreApp>,
  email: string,
): Promise<string> {
  const captcha = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json({ success: true, action: AUTH_CAPTCHA_ACTION }),
    );
  try {
    const response = await app.request(`${ORIGIN}/auth/sign-in/email`, {
      method: "POST",
      headers: {
        origin: ORIGIN,
        "content-type": "application/json",
        [AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token",
      },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    if (response.status !== 200) {
      throw new Error(`Sign-in answered ${response.status}`);
    }
    return sessionTokenCookie(response);
  } finally {
    captcha.mockRestore();
  }
}

/** A Better Auth API key of the user. */
export async function createApiKey(userId: string): Promise<string> {
  const { auth } = await import("@/lib/auth");
  const { key } = await auth.api.createApiKey({
    body: { userId, configId: "default", name: "Fixture" },
  });
  return key;
}

/** An access token of a first-party OAuth client with `sokosumi:api`. */
export async function createOAuthToken(userId: string): Promise<string> {
  const { hashStoredOAuthToken, OAUTH_ACCESS_TOKEN_PREFIX } = await import(
    "@/lib/auth-oauth-token-prefixes"
  );
  const clientId = randomUUID();
  const scopes = ["sokosumi:api"];
  await prisma.oauthClient.create({
    data: { clientId, scopes, skipConsent: true },
  });
  await prisma.oauthConsent.create({ data: { clientId, userId, scopes } });
  const token = OAUTH_ACCESS_TOKEN_PREFIX + randomUUID();
  await prisma.oauthAccessToken.create({
    data: {
      clientId,
      userId,
      scopes,
      expiresAt: new Date(Date.now() + 60 * 60_000),
      token: hashStoredOAuthToken(token, OAUTH_ACCESS_TOKEN_PREFIX),
    },
  });
  return token;
}

/** A key of a new Coworker of a new vendor. */
export async function createCoworkerKey(): Promise<string> {
  const { generateCoworkerApiKeyToken, hashApiKey } = await import(
    "@/lib/coworker-api-key"
  );
  const vendor = await prisma.vendor.create({
    data: { name: "Fixture", slug: `fixture-${randomUUID()}` },
  });
  const coworker = await prisma.coworker.create({
    data: {
      name: "Fixture",
      slug: `fixture-${randomUUID()}`,
      vendorId: vendor.id,
    },
  });
  const token = generateCoworkerApiKeyToken();
  await prisma.coworkerApiKey.create({
    data: {
      coworkerId: coworker.id,
      keyHash: await hashApiKey(token),
      keyStart: token.slice(0, 12),
    },
  });
  return token;
}

/** A key of the user's personal Soko Bot, which acts as its owner. */
export async function createSokoBotKey(userId: string): Promise<string> {
  const { generateSokoBotApiKeyToken, hashApiKey } = await import(
    "@/lib/coworker-api-key"
  );
  const workspace =
    (await prisma.workspace.findFirst({
      where: { userId, organizationId: null },
    })) ?? (await prisma.workspace.create({ data: { userId } }));
  const sokoBot = await prisma.sokoBot.create({
    data: { userId, workspaceId: workspace.id },
  });
  const token = generateSokoBotApiKeyToken();
  await prisma.coworkerApiKey.create({
    data: {
      sokoBotId: sokoBot.id,
      keyHash: await hashApiKey(token),
      keyStart: token.slice(0, 12),
    },
  });
  return token;
}

/** The session cookie of an impersonation of `userId`, started by the admin. */
export async function impersonate(
  app: ReturnType<typeof createCoreApp>,
  adminEmail: string,
  userId: string,
): Promise<string> {
  const started = await app.request(`${ORIGIN}/v1/admin/impersonation`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      cookie: await signIn(app, adminEmail),
      "content-type": "application/json",
    },
    body: JSON.stringify({ userId, reason: "SOK-1: test" }),
  });
  if (started.status !== 201) {
    throw new Error(`Impersonation answered ${started.status}`);
  }
  return sessionTokenCookie(started);
}
