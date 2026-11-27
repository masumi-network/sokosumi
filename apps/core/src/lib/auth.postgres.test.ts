import { createHash, randomUUID } from "node:crypto";
import { AUTH_CAPTCHA_ACTION, AUTH_CAPTCHA_HEADER } from "@sokosumi/utils";
import { hashPassword } from "better-auth/crypto";
import { Hono } from "hono";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { auth } from "@/lib/auth";
import prisma from "@/lib/db/prisma";
import { OpenAPIHonoWithAuth } from "@/lib/hono";
import { type AuthVariables, authMiddleware } from "@/middleware/auth";
import mountCoworkerKeyCreate from "@/routes/v1/coworkers/[id]/api-keys/post";
import { mountSokoBotApiKeyRoutes } from "@/routes/v1/soko-bots/api-keys";
import { causeMessage, expectCoreLog } from "@/test/core-log";

vi.hoisted(() => vi.stubEnv("NETWORK", "Mainnet"));

vi.mock("@vercel/functions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@vercel/functions")>()),
  waitUntil: vi.fn(),
}));

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
const apiKeyPassword = "fixture-api-key-password";
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
  instance = auth,
) {
  return instance.handler(
    new Request(`${origin}/auth${path}`, {
      method: "POST",
      headers: { origin, "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

async function signInApiKeyUser(instance = auth) {
  const captcha = passCaptcha();
  const signedIn = await post(
    "/sign-in/email",
    { email: apiKeyEmail, password: apiKeyPassword },
    captchaHeaders,
    instance,
  ).finally(() => captcha.mockRestore());
  expect(signedIn.status).toBe(200);
  return signedIn.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
}

function requestWithKey(key: string) {
  const app = new Hono<{ Variables: AuthVariables }>();
  app.use("*", authMiddleware);
  app.get("/", (c) => c.json(c.var.authContext));
  return app.request("/", { headers: { authorization: `Bearer ${key}` } });
}

function keyHash(key: string) {
  return createHash("sha256").update(key).digest("base64url");
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
    vi.unstubAllEnvs();
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

  describe("API keys", () => {
    let cookie: string;

    beforeAll(async () => {
      await prisma.user.create({
        data: {
          id: apiKeyUserId,
          name: "API Key Fixture",
          email: apiKeyEmail,
          emailVerified: true,
          role: "admin",
          createdAt: new Date(),
          updatedAt: new Date(),
          accounts: {
            create: {
              accountId: apiKeyUserId,
              providerId: "credential",
              password: await hashPassword(apiKeyPassword),
            },
          },
        },
      });
      cookie = await signInApiKeyUser();
    });

    it("mints a Mainnet key, stores six random characters and authenticates it", async () => {
      const response = await post(
        "/api-key/create",
        { name: "Mainnet" },
        {
          cookie,
        },
      );
      expect(response.status).toBe(200);
      const { id, key } = await response.json();
      expect(key).toMatch(/^soko_mainnet_[a-zA-Z]{64}$/);
      const row = await prisma.apikey.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        referenceId: apiKeyUserId,
        prefix: "soko_mainnet_",
        start: key.slice(0, 19),
        key: keyHash(key),
      });

      const accepted = await requestWithKey(key);
      expect(accepted.status).toBe(200);
      expect(await accepted.json()).toMatchObject({
        actor: "user",
        userId: apiKeyUserId,
        authenticationMethod: "api_key",
      });
    });

    it.each(["soko_preprod_", "soko_mainnet_", "custom_", "", null, 0])(
      "refuses a caller-supplied prefix %j without writing a row",
      async (prefix) => {
        const where = { referenceId: apiKeyUserId };
        const count = await prisma.apikey.count({ where });
        const response = await post(
          "/api-key/create",
          { name: "Rejected key", prefix },
          { cookie },
        );
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({
          message: "The API key prefix is set by the server.",
        });
        expect(await prisma.apikey.count({ where })).toBe(count);
      },
    );

    it("authenticates previously stored keys and lists the Network from the stored prefix", async () => {
      const suffix = "a".repeat(64);
      const fixtures = [
        { prefix: null, network: "mainnet" },
        { prefix: "soko_mainnet_", network: "mainnet" },
        { prefix: "soko_preprod_", network: "preprod" },
        { prefix: "custom_", network: "mainnet" },
      ];
      const rows = [];
      for (const { prefix, network } of fixtures) {
        const key = `${prefix ?? ""}${suffix}`;
        const row = await prisma.apikey.create({
          data: {
            prefix,
            key: keyHash(key),
            start: key.slice(0, (prefix?.length ?? 0) + 6),
            referenceId: apiKeyUserId,
            enabled: true,
            rateLimitEnabled: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        });
        rows.push({ id: row.id, prefix, start: row.start, network });

        const accepted = await requestWithKey(key);
        expect(accepted.status).toBe(200);
        expect(await accepted.json()).toMatchObject({
          actor: "user",
          userId: apiKeyUserId,
          authenticationMethod: "api_key",
        });
      }

      const response = await auth.handler(
        new Request(`${origin}/auth/api-key/list`, { headers: { cookie } }),
      );
      expect(response.status).toBe(200);
      const { apiKeys, total } = await response.json();
      expect(total).toBe(apiKeys.length);
      expect(apiKeys).toEqual(
        expect.arrayContaining(rows.map((row) => expect.objectContaining(row))),
      );
      for (const key of apiKeys) {
        expect(key).not.toHaveProperty("key");
      }
    });

    it("rejects an unknown API key", async () => {
      const failures = expectCoreLog("error", "Failed to validate API key:");
      const rejected = await requestWithKey(`unknown-${randomUUID()}`);
      expect(rejected.status).toBe(401);
      // Better Auth also catches database errors here. Check the cause of the rejection.
      expect(causeMessage(failures[0]?.cause)).toBe("Invalid API key.");
    });

    it("mints Coworker and Soko Bot keys through their routes and authenticates both", async () => {
      const vendor = await prisma.vendor.create({
        data: { name: "API key fixture", slug: `api-key-${apiKeyUserId}` },
      });
      try {
        const coworker = await prisma.coworker.create({
          data: {
            name: "API key fixture",
            slug: `api-key-${apiKeyUserId}`,
            vendorId: vendor.id,
          },
        });
        const workspace = await prisma.workspace.upsert({
          where: { userId: apiKeyUserId },
          create: { userId: apiKeyUserId },
          update: {},
        });
        const bot = await prisma.sokoBot.create({
          data: { userId: apiKeyUserId, workspaceId: workspace.id },
        });
        const coworkers = new OpenAPIHonoWithAuth();
        mountCoworkerKeyCreate(coworkers);
        const bots = new OpenAPIHonoWithAuth();
        mountSokoBotApiKeyRoutes(bots);
        const app = new Hono()
          .route("/coworkers", coworkers)
          .route("/soko-bots", bots);
        const count = await prisma.apikey.count({
          where: { referenceId: apiKeyUserId },
        });
        for (const [path, prefix, context] of [
          [
            `/coworkers/${coworker.id}/api-keys`,
            "coworker_",
            { actor: "coworker", coworkerId: coworker.id },
          ],
          [
            `/soko-bots/${bot.id}/api-keys`,
            "sokoBot_",
            { actor: "sokoBot", sokoBotId: bot.id },
          ],
        ] as const) {
          const response = await app.request(path, {
            method: "POST",
            headers: { cookie, "content-type": "application/json" },
            body: JSON.stringify({ name: "Agent key", prefix: "custom_" }),
          });
          expect(response.status).toBe(201);
          const {
            data: { id, token },
          } = await response.json();
          expect(token.startsWith(prefix)).toBe(true);
          const row = await prisma.coworkerApiKey.findUniqueOrThrow({
            where: { id },
          });
          expect(row).toMatchObject({
            keyHash: keyHash(token),
            keyStart: token.slice(0, prefix.length + 8),
          });
          const accepted = await requestWithKey(token);
          expect(accepted.status).toBe(200);
          expect(await accepted.json()).toMatchObject(context);
        }
        expect(
          await prisma.apikey.count({ where: { referenceId: apiKeyUserId } }),
        ).toBe(count);
      } finally {
        await prisma.coworker.deleteMany({ where: { vendorId: vendor.id } });
        await prisma.vendor.delete({ where: { id: vendor.id } });
      }
    });

    it("keeps explicitly Preprod minting unprefixed with six stored characters", async () => {
      vi.stubEnv("NETWORK", "Preprod");
      vi.resetModules();
      try {
        const { auth: preprodAuth } = await import("./auth");
        const cookie = await signInApiKeyUser(preprodAuth);
        const response = await post(
          "/api-key/create",
          { name: "Preprod deployment" },
          { cookie },
          preprodAuth,
        );
        expect(response.status).toBe(200);
        const { id, key } = await response.json();
        expect(key).toMatch(/^[a-zA-Z]{64}$/);
        const row = await prisma.apikey.findUniqueOrThrow({ where: { id } });
        expect(row).toMatchObject({ prefix: null, start: key.slice(0, 6) });
      } finally {
        vi.stubEnv("NETWORK", "Mainnet");
        vi.resetModules();
      }
    });
  });
});
