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
