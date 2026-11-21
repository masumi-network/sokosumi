import { randomUUID } from "node:crypto";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { type AuthVariables, authMiddleware } from "@/middleware/auth";
import { causeMessage, expectCoreLog } from "@/test/core-log";

vi.mock("@/helpers/background-email", () => ({
  sendEmailInBackground: vi.fn(),
}));

vi.mock("@/clients/stripe.client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/clients/stripe.client")>();
  return {
    ...actual,
    stripeClient: {
      ...actual.stripeClient,
      createUserCustomer: vi.fn().mockResolvedValue({}),
    },
  };
});
vi.mock("@/services/webhook.service", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/webhook.service")>();
  return {
    ...actual,
    webhookService: {
      ...actual.webhookService,
      callAccountCreated: vi.fn().mockResolvedValue(undefined),
      callUserWebhook: vi.fn().mockResolvedValue(undefined),
    },
  };
});

const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  process.env.DATABASE_URL?.startsWith("postgres");
const origin = "https://example.com";
const passwordEmail = `password-${randomUUID()}@example.test`;
const googleEmail = `google-${randomUUID()}@example.test`;
const otpEmail = `otp-${randomUUID()}@example.test`;
const apiKeyUserId = randomUUID();
const apiKeyEmail = `api-key-${apiKeyUserId}@example.test`;
const captchaHeaders = { [AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token" };

function passCaptcha() {
  return vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(async () =>
      Response.json({ success: true, action: AUTH_CAPTCHA_ACTION }),
    );
}

function post(
  path: string,
  body: object,
  headers: Record<string, string> = {},
) {
  return auth.handler(
    new Request(`${origin}/auth${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe.runIf(enabled)("Core Better Auth with PostgreSQL", () => {
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await prisma.apikey.deleteMany({ where: { referenceId: apiKeyUserId } });
    await prisma.verification.deleteMany({
      where: { identifier: { endsWith: otpEmail } },
    });
    await prisma.user.deleteMany({
      where: {
        email: { in: [passwordEmail, googleEmail, otpEmail, apiKeyEmail] },
      },
    });
    await prisma.$disconnect();
  });

  it("signs in with email and password through the real adapter", async () => {
    const password = "fixture-password-long";
    const userId = randomUUID();
    await prisma.user.create({
      data: {
        id: userId,
        name: "Password Fixture",
        email: passwordEmail,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        accounts: {
          create: {
            accountId: userId,
            providerId: "credential",
            password: await hashPassword(password),
          },
        },
      },
    });
    const verify = passCaptcha();

    const response = await post(
      "/sign-in/email",
      { email: passwordEmail, password },
      captchaHeaders,
    );

    expect(verify).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join("\n")).toContain(
      "session_token=",
    );
    expect(await prisma.session.count({ where: { userId } })).toBe(1);
  });

  it("persists a Google OAuth callback without optional profile claims", async () => {
    // Replace the provider's network calls. Core still handles OAuth state,
    // the callback, profile mapping, session hooks and Prisma writes.
    const { socialProviders } = await auth.$context;
    const google = socialProviders.find((provider) => provider.id === "google");
    if (!google) throw new Error("Missing Google provider");
    const subject = randomUUID();
    vi.spyOn(google, "validateAuthorizationCode").mockResolvedValueOnce({
      accessToken: "fixture-access-token",
      scopes: ["openid", "email"],
    });
    vi.spyOn(google, "getUserInfo").mockResolvedValueOnce({
      user: { name: "Google Fixture", email: googleEmail, emailVerified: true },
      data: { sub: subject, name: "Google Fixture" },
    });
    const landing = `${origin}/account`;
    const started = await post("/sign-in/social", {
      provider: "google",
      callbackURL: landing,
    });
    expect(started.status).toBe(200);
    const authorization = new URL((await started.json()).url);
    const state = authorization.searchParams.get("state");
    const redirectUri = authorization.searchParams.get("redirect_uri");
    if (!state || !redirectUri)
      throw new Error("Missing OAuth state or redirect URI");
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", "fixture-code");
    callback.searchParams.set("state", state);
    const cookie = started.headers
      .getSetCookie()
      .map((header) => header.split(";", 1)[0])
      .join("; ");

    const response = await auth.handler(
      new Request(callback, {
        headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
      }),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(landing);
    expect(response.headers.getSetCookie().join("\n")).toContain(
      "session_token=",
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: googleEmail },
      include: { accounts: true, sessions: true },
    });
    expect(user).toMatchObject({
      firstName: null,
      lastName: null,
      image: null,
      accounts: [
        expect.objectContaining({ providerId: "google", accountId: subject }),
      ],
      sessions: [expect.objectContaining({ userId: user.id })],
    });
  });

  it("creates a verified user and session with an emailed code", async () => {
    passCaptcha();
    const lines: string[] = [];
    const output = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk) => {
        if (typeof chunk === "string") lines.push(chunk);
        return true;
      });
    const sent = await post(
      "/email-otp/send-verification-otp",
      { email: otpEmail, type: "sign-in" },
      captchaHeaders,
    ).finally(() => output.mockRestore());
    expect(sent.status).toBe(200);
    const prefix = `[email code] ${otpEmail}: `;
    const otp = lines
      .find((line) => line.startsWith(prefix))
      ?.slice(prefix.length)
      .trim();
    if (!otp || !/^\d{6}$/.test(otp))
      throw new Error("Missing development email code");

    const response = await post("/sign-in/email-otp", {
      email: otpEmail,
      otp,
      firstName: "Email",
      lastName: "Fixture",
      password: "fixture-password-long",
      termsAccepted: true,
    });
    expect(response.status).toBe(200);
    expect(response.headers.getSetCookie().join("\n")).toContain(
      "session_token=",
    );
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: otpEmail },
      include: { accounts: true, sessions: true },
    });
    expect(user).toMatchObject({
      emailVerified: true,
      termsAccepted: true,
      accounts: [expect.objectContaining({ providerId: "credential" })],
      sessions: [expect.objectContaining({ userId: user.id })],
    });
  });

  it("authenticates a created API key and rejects an unknown key", async () => {
    await prisma.user.create({
      data: {
        id: apiKeyUserId,
        name: "API Key Fixture",
        email: apiKeyEmail,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const { key } = await auth.api.createApiKey({
      body: { userId: apiKeyUserId, configId: "default", name: "Smoke test" },
    });

    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", authMiddleware);
    app.get("/", (c) => c.json(c.var.authContext));

    const accepted = await app.request("/", {
      headers: { authorization: `Bearer ${key}` },
    });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({
      actor: "user",
      userId: apiKeyUserId,
      authenticationMethod: "api_key",
    });

    const failures = expectCoreLog("error", "Failed to validate API key:");
    const rejected = await app.request("/", {
      headers: { authorization: `Bearer unknown-${randomUUID()}` },
    });
    expect(rejected.status).toBe(401);
    // Better Auth also catches database errors here. Check the cause of the rejection.
    expect(causeMessage(failures[0]?.cause)).toBe("Invalid API key.");
  });
});
