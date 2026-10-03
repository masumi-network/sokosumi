import { createHash, randomUUID } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt, oAuthProxy } from "better-auth/plugins";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { answerCreatePromptWithNewSession } from "./auth-oauth-provider";
import {
  claimSignUpConversion,
  oauthSignUpOptions,
  recordSignUpConversion,
  takeSignUpConversionRedirect,
} from "./auth-sign-up-conversion";

// Owned stateful persistence fixture: tests observe claims and rollback, rather
// than returning the expected query results independently of earlier writes.
const fixture = vi.hoisted(() => {
  interface Row {
    id: string;
    identifier: string;
    value: string;
    expiresAt: Date;
  }
  const rows: Row[] = [];
  const attributions: string[] = [];
  let failAttribution = false;
  const verification = {
    async createMany({ data }: { data: Omit<Row, "id">[] }) {
      rows.push(
        ...data.map((row, index) => ({
          ...row,
          id: `${row.identifier}:${index}`,
        })),
      );
    },
    async findFirst({
      where,
    }: {
      where: { identifier: string; expiresAt: { gt: Date } };
    }) {
      return (
        rows.find(
          (row) =>
            row.identifier === where.identifier &&
            row.expiresAt > where.expiresAt.gt,
        ) ?? null
      );
    },
    async deleteMany({
      where,
    }: {
      where: {
        id?: string;
        identifier?: string;
        expiresAt?: { gt: Date };
        value?: { in: string[] };
      };
    }) {
      let count = 0;
      for (let index = rows.length - 1; index >= 0; index--) {
        const row = rows[index];
        if (
          (!where.id || row.id === where.id) &&
          (!where.identifier || row.identifier === where.identifier) &&
          (!where.expiresAt || row.expiresAt > where.expiresAt.gt) &&
          (!where.value || where.value.in.includes(row.value))
        ) {
          rows.splice(index, 1);
          count++;
        }
      }
      return { count };
    },
  };
  const tx = {
    verification,
    uTMAttribution: {
      async upsert({ where }: { where: { userId: string } }) {
        if (failAttribution) throw new Error("attribution unavailable");
        attributions.push(where.userId);
      },
    },
  };
  let tail = Promise.resolve();
  return {
    rows,
    attributions,
    verification,
    setFailure(value: boolean) {
      failAttribution = value;
    },
    async $transaction<T>(callback: (client: typeof tx) => Promise<T>) {
      const previous = tail;
      let release = () => {};
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      await previous;
      const snapshot = [...rows];
      try {
        return await callback(tx);
      } catch (error) {
        rows.splice(0, rows.length, ...snapshot);
        throw error;
      } finally {
        release();
      }
    },
  };
});
vi.mock("@/lib/db/prisma", () => ({ default: fixture }));

const WEB = "https://web.example.test";
const CORE = "https://core.example.test";
const PREVIEW = "https://preview.example.test";
const CLIENT = "https://cmo.example.test/callback";
const SECRET = "owned-offline-auth-fixture-secret-32-characters";

function createAuth(origin = CORE, proxy = false) {
  const store: Record<string, Record<string, unknown>[]> = {
    user: [],
    account: [],
    session: [],
    verification: [],
    jwks: [],
    oauthConsent: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthClient: [
      {
        id: randomUUID(),
        clientId: "cmo",
        public: true,
        disabled: false,
        skipConsent: true,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code"],
        responseTypes: ["code"],
        redirectUris: [CLIENT],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ],
  };
  const auth = betterAuth({
    baseURL: origin,
    basePath: "/auth",
    secret: SECRET,
    database: memoryAdapter(store),
    trustedOrigins: [WEB, CORE, PREVIEW],
    emailAndPassword: { enabled: true },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "microsoft"],
      },
    },
    socialProviders: {
      google: { clientId: "fixture-google", clientSecret: "fixture-secret" },
      microsoft: {
        clientId: "fixture-microsoft",
        clientSecret: "fixture-secret",
      },
    },
    databaseHooks: {
      user: {
        create: { after: (user, ctx) => recordSignUpConversion(user.id, ctx) },
      },
    },
    hooks: { after: createAuthMiddleware(answerCreatePromptWithNewSession) },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        signup: oauthSignUpOptions(WEB),
      }),
      ...(proxy
        ? [
            oAuthProxy({
              productionURL: CORE,
              currentURL: origin,
              secret: SECRET,
            }),
          ]
        : []),
    ],
    rateLimit: { enabled: false },
  });
  return { auth, store };
}

function jar() {
  const cookies = new Map<string, string>();
  return {
    receive(response: Response) {
      for (const header of response.headers.getSetCookie()) {
        const pair = header.split(";", 1)[0];
        const separator = pair.indexOf("=");
        cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    },
    headers() {
      return {
        cookie: [...cookies]
          .map(([key, value]) => `${key}=${value}`)
          .join("; "),
        origin: WEB,
      };
    },
  };
}

async function socialFlow(
  provider: "google" | "microsoft",
  options: {
    proxy?: boolean;
    oauth?: boolean;
    prompt?: string;
    existing?: boolean;
  } = {},
) {
  const origin = options.proxy ? PREVIEW : CORE;
  const instance = createAuth(origin, options.proxy);
  const browser = jar();
  if (options.existing) {
    await instance.auth.api.signUpEmail({
      body: {
        email: "fixture@example.test",
        name: "Fixture",
        password: "fixture-password-long",
      },
    });
    instance.store.user[0].emailVerified = true;
  }
  // Only the external token exchange is replaced. State, callback routing,
  // user/account creation, hooks, cookies and authorization run installed BA.
  const installProvider = async (auth: typeof instance.auth) => {
    const context = await auth.$context;
    for (const item of context.socialProviders) {
      item.getUserInfo = async () => ({
        user: {
          name: "Fixture",
          email: "fixture@example.test",
          emailVerified: true,
        },
        data: { sub: "google-fixture", oid: "microsoft-fixture" },
      });
      item.validateAuthorizationCode = async () => ({
        accessToken: "owned-fixture-token",
        scopes: ["openid", "email"],
      });
    }
  };
  await installProvider(instance.auth);
  let oauthQuery: string | undefined;
  if (options.oauth) {
    const query = new URLSearchParams({
      client_id: "cmo",
      redirect_uri: CLIENT,
      response_type: "code",
      scope: "openid",
      state: "client-state",
      code_challenge: createHash("sha256")
        .update("fixture-pkce-verifier-long-enough-for-validation")
        .digest("base64url"),
      code_challenge_method: "S256",
      ...(options.prompt ? { prompt: options.prompt } : {}),
    });
    const response = await instance.auth.handler(
      new Request(`${origin}/auth/oauth2/authorize?${query}`, {
        headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
      }),
    );
    browser.receive(response);
    oauthQuery = new URL(
      response.headers.get("location") ?? "",
    ).searchParams.toString();
  }
  const start = await instance.auth.api.signInSocial({
    body: {
      provider,
      callbackURL: `${WEB}/auth/callback/signin?provider=${provider}`,
      newUserCallbackURL: `${WEB}/auth/callback/signup?provider=${provider}`,
      ...(oauthQuery ? { oauth_query: oauthQuery } : {}),
    },
    headers: new Headers(browser.headers()),
    asResponse: true,
  });
  browser.receive(start);
  const providerURL = new URL((await start.json()).url);
  const callbackTarget = providerURL.searchParams.get("redirect_uri") ?? "";
  const callbackURL = new URL(callbackTarget);
  callbackURL.searchParams.set("code", "owned-fixture-code");
  callbackURL.searchParams.set(
    "state",
    providerURL.searchParams.get("state") ?? "",
  );
  let response: Response;
  if (options.proxy) {
    const production = createAuth(CORE, true);
    await installProvider(production.auth);
    response = await production.auth.handler(
      new Request(callbackURL, {
        headers: { accept: "text/html", "sec-fetch-mode": "navigate" },
      }),
    );
    expect(production.store.user).toHaveLength(0);
    response = await instance.auth.handler(
      new Request(response.headers.get("location") ?? "", {
        headers: {
          ...browser.headers(),
          accept: "text/html",
          "sec-fetch-mode": "navigate",
        },
      }),
    );
  } else
    response = await instance.auth.handler(
      new Request(callbackURL, {
        headers: {
          ...browser.headers(),
          accept: "text/html",
          "sec-fetch-mode": "navigate",
        },
      }),
    );
  browser.receive(response);
  return { ...instance, browser, response, origin };
}

describe("installed Better Auth social sign-up flows", () => {
  beforeEach(() => {
    fixture.rows.length = 0;
    fixture.attributions.length = 0;
    fixture.setFailure(false);
  });

  it("ignores expired and unsupported stored markers", async () => {
    fixture.rows.push(
      {
        id: "expired",
        identifier: "sign-up-conversion:user-expired",
        value: "google",
        expiresAt: new Date(0),
      },
      {
        id: "unsupported",
        identifier: "sign-up-conversion:user-invalid",
        value: "github",
        expiresAt: new Date(Date.now() + 60_000),
      },
      {
        id: "bad-redirect",
        identifier: "sign-up-conversion-redirect:user-invalid",
        value: "github",
        expiresAt: new Date(Date.now() + 60_000),
      },
    );
    expect(await claimSignUpConversion("user-expired")).toBeNull();
    expect(await claimSignUpConversion("user-invalid")).toBeNull();
    expect(await takeSignUpConversionRedirect("user-invalid")).toBe(false);
    expect(await claimSignUpConversion("other-user")).toBeNull();
  });

  it.each(["google", "microsoft"] as const)(
    "records only a new %s callback account and rolls back failed UTM writes",
    async (provider) => {
      const flow = await socialFlow(provider);
      expect(flow.response.headers.get("location")).toBe(
        `${WEB}/auth/callback/signup?provider=${provider}`,
      );
      const userId = String(flow.store.user[0].id);
      fixture.setFailure(true);
      const utm = {
        utm_source: "owned-test",
        capturedAt: new Date().toISOString(),
      };
      await expect(claimSignUpConversion(userId, utm)).rejects.toThrow(
        "attribution unavailable",
      );
      expect(fixture.rows).toHaveLength(2);
      fixture.setFailure(false);
      expect(
        await Promise.all([
          claimSignUpConversion(userId, utm),
          claimSignUpConversion(userId, utm),
        ]),
      ).toEqual([provider, null]);
      expect(fixture.attributions).toEqual([userId]);
      expect(fixture.rows).toHaveLength(0);
    },
  );

  it.each(["google", "microsoft"] as const)(
    "does not record %s linking to an existing verified user",
    async (provider) => {
      const flow = await socialFlow(provider, { existing: true });
      expect(flow.store.user).toHaveLength(1);
      expect(flow.store.account).toHaveLength(2);
      expect(flow.response.headers.get("location")).toBe(
        `${WEB}/auth/callback/signin?provider=${provider}`,
      );
      expect(fixture.rows).toHaveLength(0);
    },
  );

  it.each([
    { provider: "google" as const, proxy: false, prompt: undefined },
    { provider: "microsoft" as const, proxy: false, prompt: "create" },
    { provider: "google" as const, proxy: true, prompt: undefined },
    { provider: "microsoft" as const, proxy: true, prompt: "create" },
  ])(
    "counts CMO $provider signup before continuing (proxy=$proxy, prompt=$prompt)",
    async ({ provider, proxy, prompt }) => {
      const flow = await socialFlow(provider, { oauth: true, proxy, prompt });
      const signup = new URL(flow.response.headers.get("location") ?? "");
      expect(signup.origin + signup.pathname).toBe(`${WEB}/signup`);
      expect(signup.searchParams.get("state")).toBe("client-state");
      expect(signup.searchParams.get("client_id")).toBe("cmo");
      expect(signup.searchParams.has("sig")).toBe(true);
      // The new session answered "Create account": the page hands the
      // request back without asking which account to continue as.
      expect(signup.searchParams.has("prompt")).toBe(false);
      const userId = String(flow.store.user[0].id);
      expect(await claimSignUpConversion(userId)).toBe(provider);
      const continued = await flow.auth.handler(
        new Request(`${flow.origin}/auth/oauth2/continue`, {
          method: "POST",
          headers: {
            ...flow.browser.headers(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            created: true,
            oauth_query: signup.searchParams.toString(),
          }),
        }),
      );
      const result = await continued.json();
      expect(result, JSON.stringify(result)).toMatchObject({ redirect: true });
      expect(new URL(result.url).origin + new URL(result.url).pathname).toBe(
        CLIENT,
      );
      expect(new URL(result.url).searchParams.get("state")).toBe(
        "client-state",
      );
      expect(new URL(result.url).searchParams.has("code")).toBe(true);
      expect(await claimSignUpConversion(userId)).toBeNull();
    },
  );

  it.each([
    { provider: "google" as const, proxy: false },
    { provider: "microsoft" as const, proxy: true },
  ])(
    "sends a CMO Create account $provider sign-in straight to CMO (proxy=$proxy)",
    async ({ provider, proxy }) => {
      const flow = await socialFlow(provider, {
        oauth: true,
        proxy,
        prompt: "create",
        existing: true,
      });
      const target = new URL(flow.response.headers.get("location") ?? "");
      expect(target.origin + target.pathname).toBe(CLIENT);
      expect(target.searchParams.get("state")).toBe("client-state");
      expect(target.searchParams.has("code")).toBe(true);
    },
  );
});
