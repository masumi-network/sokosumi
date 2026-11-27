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
import { onSplitLayout } from "@/test/split-layout";

vi.hoisted(() => {
  vi.stubEnv("NETWORK", "Mainnet");
  vi.stubEnv("NETWORK_PREPROD_ENABLED", "false");
});

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
const SETUP_TIMEOUT = 60_000;

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

async function createApiKeyUser({
  id,
  email,
  name,
  role,
  preprodEnabled = false,
}: {
  id: string;
  email: string;
  name: string;
  role: string;
  preprodEnabled?: boolean;
}) {
  await prisma.user.create({
    data: {
      id,
      email,
      name,
      role,
      preprodEnabled,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      accounts: {
        create: {
          accountId: id,
          providerId: "credential",
          password: await hashPassword(apiKeyPassword),
        },
      },
    },
  });
}

async function signInApiKeyUser(instance = auth, email = apiKeyEmail) {
  const captcha = passCaptcha();
  const signedIn = await post(
    "/sign-in/email",
    { email, password: apiKeyPassword },
    captchaHeaders,
    instance,
  ).finally(() => captcha.mockRestore());
  expect(signedIn.status).toBe(200);
  return signedIn.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
}

function listApiKeys(cookie: string, instance = auth) {
  return instance.handler(
    new Request(`${origin}/auth/api-key/list`, { headers: { cookie } }),
  );
}

async function expectCreateRefused(
  userId: string,
  cookie: string,
  body: object,
  status: number,
  error: object,
  instance = auth,
) {
  const where = { referenceId: userId };
  const count = await prisma.apikey.count({ where });
  const response = await post("/api-key/create", body, { cookie }, instance);
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject(error);
  expect(await prisma.apikey.count({ where })).toBe(count);
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
      await createApiKeyUser({
        id: apiKeyUserId,
        name: "API Key Fixture",
        email: apiKeyEmail,
        role: "admin",
      });
      cookie = await signInApiKeyUser();
    }, SETUP_TIMEOUT);

    it.each([{ name: "Mainnet" }, { name: "Mainnet", network: "mainnet" }])(
      "mints and authenticates a Mainnet key for %j",
      async (body) => {
        const userFind = vi.spyOn(prisma.user, "findUnique");
        const response = await post("/api-key/create", body, { cookie });
        expect(response.status).toBe(200);
        expect(userFind).not.toHaveBeenCalled();
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
      },
    );

    it.each(["soko_preprod_", "soko_mainnet_", "custom_", "", null, 0])(
      "refuses a caller-supplied prefix %j without writing a row",
      async (prefix) => {
        await expectCreateRefused(
          apiKeyUserId,
          cookie,
          { name: "Rejected key", prefix },
          400,
          { message: "The API key prefix is set by the server." },
        );
      },
    );

    it("refuses a caller-supplied prefix alongside a Network", async () => {
      await expectCreateRefused(
        apiKeyUserId,
        cookie,
        { name: "Rejected key", prefix: "custom_", network: "preprod" },
        400,
        { message: "The API key prefix is set by the server." },
      );
    });

    it.each(
      ["unknown", "Mainnet", "", null, 0, false, ["preprod"]].map(
        (network) => ({ network }),
      ),
    )(
      "refuses an invalid Network in %j without writing a row",
      async ({ network }) => {
        await expectCreateRefused(
          apiKeyUserId,
          cookie,
          { name: "Rejected key", network },
          400,
          { message: "Network must be mainnet or preprod." },
        );
      },
    );

    it("refuses Preprod while switched off, even for an admin", async () => {
      await expectCreateRefused(
        apiKeyUserId,
        cookie,
        { name: "Rejected key", network: "preprod" },
        403,
        { kind: "preprod_off" },
      );
    });

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

      const response = await listApiKeys(cookie);
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

    it(
      "keeps explicitly Preprod minting unprefixed with six stored characters",
      async () => {
        vi.stubEnv("NETWORK", "Preprod");
        vi.resetModules();
        try {
          const { auth: preprodAuth } = await import("./auth");
          const cookie = await signInApiKeyUser(preprodAuth);
          for (const body of [
            { name: "Preprod deployment" },
            { name: "Preprod deployment", network: "mainnet" },
          ]) {
            const response = await post(
              "/api-key/create",
              body,
              { cookie },
              preprodAuth,
            );
            expect(response.status).toBe(200);
            const { id, key } = await response.json();
            expect(key).toMatch(/^[a-zA-Z]{64}$/);
            const row = await prisma.apikey.findUniqueOrThrow({
              where: { id },
            });
            expect(row).toMatchObject({ prefix: null, start: key.slice(0, 6) });
          }
          await expectCreateRefused(
            apiKeyUserId,
            cookie,
            { name: "Rejected key", network: "preprod" },
            403,
            { kind: "preprod_off" },
            preprodAuth,
          );
        } finally {
          vi.stubEnv("NETWORK", "Mainnet");
          vi.resetModules();
        }
      },
      SETUP_TIMEOUT,
    );

    describe.runIf(onSplitLayout)("with Preprod switched on", () => {
      let enabledAuth: typeof auth;
      let enabledCookie: string;
      let organizationId: string;
      const people = [
        { name: "plain user", role: "user" },
        {
          name: "member of a non-opted-in organization",
          role: "user",
          organization: false,
        },
        { name: "platform admin", role: "admin", allowed: true },
        { name: "opted-in user", role: "user", optedIn: true, allowed: true },
        {
          name: "member of an opted-in organization",
          role: "user",
          organization: true,
          allowed: true,
        },
      ];
      const userIds: string[] = [];

      beforeAll(async () => {
        vi.stubEnv("NETWORK_PREPROD_ENABLED", "true");
        vi.resetModules();
        try {
          ({ auth: enabledAuth } = await import("./auth"));
          enabledCookie = await signInApiKeyUser(enabledAuth);
        } finally {
          vi.stubEnv("NETWORK_PREPROD_ENABLED", "false");
        }
        const organization = await prisma.organization.create({
          data: {
            name: "Preprod access fixture",
            slug: `preprod-access-${apiKeyUserId}`,
            preprodEnabled: true,
          },
        });
        organizationId = organization.id;
      }, SETUP_TIMEOUT);

      afterAll(async () => {
        await prisma.apikey.deleteMany({
          where: { referenceId: { in: userIds } },
        });
        await prisma.user.deleteMany({ where: { id: { in: userIds } } });
        await prisma.organization.deleteMany({
          where: {
            slug: {
              in: [
                `preprod-access-${apiKeyUserId}`,
                `mainnet-access-${apiKeyUserId}`,
              ],
            },
          },
        });
        vi.resetModules();
      });

      it.each(people)(
        "enforces Preprod access for $name",
        async ({ name, role, organization, optedIn, allowed }) => {
          const id = randomUUID();
          const email = `api-key-${id}@example.test`;
          userIds.push(id);
          await createApiKeyUser({
            id,
            email,
            name,
            role,
            preprodEnabled: optedIn,
          });
          if (organization === true) {
            await prisma.member.create({
              data: { userId: id, organizationId },
            });
          } else if (organization === false) {
            await prisma.organization.create({
              data: {
                name: "Mainnet access fixture",
                slug: `mainnet-access-${apiKeyUserId}`,
                members: { create: { userId: id } },
              },
            });
          }
          const cookie = await signInApiKeyUser(enabledAuth, email);
          const body = { name: "Preprod key", network: "preprod" };
          if (!allowed) {
            await expectCreateRefused(
              id,
              cookie,
              body,
              403,
              { kind: "preprod_access_required" },
              enabledAuth,
            );
            return;
          }

          const response = await post(
            "/api-key/create",
            body,
            { cookie },
            enabledAuth,
          );
          expect(response.status).toBe(200);
          const {
            id: keyId,
            key,
            name: keyName,
            prefix,
          } = await response.json();
          expect(keyName).toBe(body.name);
          expect(key).toMatch(/^soko_preprod_[a-zA-Z]{64}$/);
          expect(prefix).toBe("soko_preprod_");
          const row = await prisma.apikey.findUniqueOrThrow({
            where: { id: keyId },
          });
          expect(row).toMatchObject({
            referenceId: id,
            prefix,
            start: key.slice(0, 19),
            key: keyHash(key),
          });

          const listed = await listApiKeys(cookie, enabledAuth);
          expect(listed.status).toBe(200);
          const { apiKeys } = await listed.json();
          expect(apiKeys).toMatchObject([
            { id: keyId, prefix, network: "preprod" },
          ]);
        },
      );

      it("reads access only for a Preprod create", async () => {
        const userFind = vi.spyOn(prisma.user, "findUnique");
        for (const body of [
          { name: "Default" },
          { name: "Explicit", network: "mainnet" },
        ]) {
          const response = await post(
            "/api-key/create",
            body,
            { cookie: enabledCookie },
            enabledAuth,
          );
          expect(response.status).toBe(200);
          expect((await response.json()).prefix).toBe("soko_mainnet_");
          expect(userFind).not.toHaveBeenCalled();
        }
        const response = await post(
          "/api-key/create",
          { name: "Explicit", network: "preprod" },
          { cookie: enabledCookie },
          enabledAuth,
        );
        expect(response.status).toBe(200);
        expect(userFind).toHaveBeenCalledTimes(1);
      });
    });
  });
});
