import { randomUUID } from "node:crypto";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";

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
    await prisma.user.deleteMany({
      where: { email: { in: [passwordEmail, googleEmail] } },
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
    const verify = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () =>
        Response.json({ success: true, action: AUTH_CAPTCHA_ACTION }),
      );

    const response = await post(
      "/sign-in/email",
      { email: passwordEmail, password },
      { [AUTH_CAPTCHA_HEADER]: "fixture-turnstile-token" },
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
});
