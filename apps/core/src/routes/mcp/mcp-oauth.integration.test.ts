import "@hono/zod-openapi";

import { createHash, randomUUID } from "node:crypto";
import {
  createMCPClient,
  auth as mcpAuth,
  type OAuthClientInformation,
  type OAuthClientMetadata,
  type OAuthClientProvider,
  type OAuthTokens,
  UnauthorizedError,
} from "@ai-sdk/mcp";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import {
  applyOAuthClientPolicy,
  clientRegistrationOptions,
} from "@/lib/auth-oauth-provider";
import {
  OAUTH_ACCESS_TOKEN_PREFIX,
  OAUTH_REFRESH_TOKEN_PREFIX,
} from "@/lib/auth-oauth-token-prefixes";
import {
  mcpOAuthResource,
  mcpResourceIdentifier,
} from "@/lib/sokosumi-mcp/resource";
import authRouter from "@/routes/auth/index";
import apiV1 from "@/routes/v1/index";
import wellKnownRouter from "@/routes/well-known/index";

import mcpRouter from "./index";

/**
 * The MCP OAuth flow end to end (ADR 0076), as Claude Code runs it: a real MCP
 * client with an `OAuthClientProvider` against Core's own routers. Better
 * Auth runs on an in-memory store with Core's MCP resource and open client
 * registration; the browser steps (sign-in, consent) are plain requests.
 */

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;
type TestAuth = ReturnType<typeof createAuth>;

const h = vi.hoisted(() => ({
  store: {} as Store,
  auth: undefined as unknown,
}));

// Core reads grants through Prisma; here it reads the rows Better Auth wrote.
vi.mock("@/lib/db/prisma", () => {
  const find = (model: string, where: Row) =>
    h.store[model]?.find((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value),
    ) ?? null;
  const model = (name: string) => ({
    findUnique: async ({ where }: { where: Row }) => find(name, where),
    // Ignores `orderBy`: each test has at most one consent per client.
    findFirst: async ({ where }: { where: Row }) => find(name, where),
  });
  return {
    default: {
      user: model("user"),
      oauthClient: model("oauthClient"),
      oauthConsent: model("oauthConsent"),
      oauthRefreshToken: model("oauthRefreshToken"),
      // `/v1` reads an opaque token with its grant in one query.
      oauthAccessToken: {
        findUnique: async ({ where }: { where: Row }) => {
          const token = find("oauthAccessToken", where);
          return (
            token && {
              ...token,
              refreshToken: find("oauthRefreshToken", { id: token.refreshId }),
              user: find("user", { id: token.userId }),
              client: find("oauthClient", { clientId: token.clientId }),
            }
          );
        },
      },
    },
  };
});

// Core's routers import `auth` when they load; each test builds its own, so
// the export forwards to it. `/v1` tries a bearer that is not an OAuth access
// token as an API key first, which needs the api-key plugin Core has.
vi.mock("@/lib/auth", () => ({
  auth: new Proxy(
    {},
    {
      get: (_target, key) => {
        const auth = h.auth as Record<PropertyKey, unknown>;
        return key === "api"
          ? {
              ...(auth.api as object),
              verifyApiKey: async () => ({ valid: false }),
            }
          : auth[key];
      },
    },
  ),
}));

const CORE = "https://core.example.test";
const WEB = "https://web.example.test";
const MCP = mcpResourceIdentifier(CORE);
// Claude Code listens on loopback (a native client); Claude.ai calls back
// to its own https page (a web client).
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const CLAUDE_AI_REDIRECT_URI = "https://claude.ai/api/mcp/auth_callback";
const MCP_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
];
// A first-party client allowed `/v1`, such as the Sokosumi CLI.
const API_CLIENT_ID = "sokosumi-cli";
const API_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_OFFLINE_ACCESS,
];

/** Core's provider settings (`src/lib/auth.ts`) for MCP and registration. */
function createAuth(store: Store) {
  return betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: "owned-offline-auth-fixture-secret-32-characters",
    database: memoryAdapter(store),
    trustedOrigins: [WEB, CORE],
    emailAndPassword: { enabled: true },
    hooks: {
      before: createAuthMiddleware(async (ctx) =>
        applyOAuthClientPolicy(ctx, MCP),
      ),
    },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        scopes: [...OAUTH_PROVIDER_SCOPES, OAUTH_SCOPE_MCP],
        resources: [mcpOAuthResource(CORE)],
        ...clientRegistrationOptions(MCP),
        grantTypes: ["authorization_code", "refresh_token"],
        prefix: {
          opaqueAccessToken: OAUTH_ACCESS_TOKEN_PREFIX,
          refreshToken: OAUTH_REFRESH_TOKEN_PREFIX,
        },
      }),
    ],
    rateLimit: { enabled: false },
  });
}

/** Core as `src/index.ts` mounts it. */
const app = new Hono();
app.use(requestId());
app.onError(errorHandler);
app.route("/", wellKnownRouter);
app.route("/auth", authRouter);
app.route("/v1", apiV1);
app.route("/mcp", mcpRouter);

let auth: TestAuth;
let store: Store;
let cookie: string;
/** Every request the MCP client sent, in order. */
let sent: string[];

const fetchCore = async (
  input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> => {
  const request = new Request(input, init);
  sent.push(`${request.method} ${new URL(request.url).pathname}`);
  return await app.request(request);
};

beforeEach(async () => {
  store = {
    user: [],
    account: [],
    session: [],
    verification: [],
    jwks: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthResource: [],
    oauthClient: [],
    oauthClientResource: [],
    oauthConsent: [],
  };
  h.store = store;
  auth = createAuth(store);
  h.auth = auth;
  sent = [];

  const signUp = await auth.api.signUpEmail({
    body: {
      email: "agent-owner@example.test",
      name: "Agent Owner",
      password: "fixture-password-long",
    },
    asResponse: true,
  });
  cookie = signUp.headers
    .getSetCookie()
    .map((header) => header.split(";", 1)[0])
    .join("; ");
  // Columns Core's own auth config adds to every user, which `/v1/users/me`
  // returns.
  Object.assign(store.user[0], {
    firstName: "Agent",
    lastName: "Owner",
    role: "user",
  });
});

const clients: { close(): Promise<void> }[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close()));
});

/**
 * What an MCP client keeps between runs, plus the person in the browser:
 * `redirectToAuthorization` opens the authorize URL signed in, approves the
 * consent page as Web does, and keeps the code the callback receives.
 */
class TestOAuthProvider implements OAuthClientProvider {
  client?: OAuthClientInformation;
  saved?: OAuthTokens;
  verifier = "";
  callback?: URL;

  constructor(
    readonly name = "Claude Code",
    readonly redirectUri = REDIRECT_URI,
  ) {}

  get redirectUrl() {
    return this.redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: this.name,
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  clientInformation() {
    return this.client;
  }
  saveClientInformation(client: OAuthClientInformation) {
    this.client = client;
  }
  tokens() {
    return this.saved;
  }
  saveTokens(tokens: OAuthTokens) {
    this.saved = tokens;
  }
  saveCodeVerifier(verifier: string) {
    this.verifier = verifier;
  }
  codeVerifier() {
    return this.verifier;
  }

  async redirectToAuthorization(authorizationUrl: URL) {
    const authorize = await app.request(authorizationUrl, {
      headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    });
    const consentPage = new URL(authorize.headers.get("location") ?? "");
    expect(`${consentPage.origin}${consentPage.pathname}`).toBe(
      `${WEB}/oauth/consent`,
    );

    const consent = await app.request(`${CORE}/auth/oauth2/consent`, {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({
        accept: true,
        oauth_query: consentPage.search.slice(1),
      }),
    });
    expect(consent.status).toBe(200);
    const { url } = (await consent.json()) as { url: string };
    this.callback = new URL(url);
  }
}

/** Connects as Claude Code does: 401, sign in in the browser, connect again. */
async function connectWithOAuth(provider = new TestOAuthProvider()) {
  const transport = {
    type: "http" as const,
    // `users` is off by default; users_get proves the token acts as the person.
    url: `${MCP}?toolsets=workspaces,users`,
    authProvider: provider,
    fetch: fetchCore,
  };
  await expect(createMCPClient({ transport })).rejects.toThrow(
    UnauthorizedError,
  );
  const callback = provider.callback;
  expect(callback?.origin + (callback?.pathname ?? "")).toBe(
    provider.redirectUri,
  );

  await expect(
    mcpAuth(provider, {
      serverUrl: MCP,
      authorizationCode: callback?.searchParams.get("code") ?? "",
      callbackState: callback?.searchParams.get("state") ?? undefined,
      callbackIssuer: callback?.searchParams.get("iss") ?? undefined,
      fetchFn: fetchCore,
    }),
  ).resolves.toBe("AUTHORIZED");

  const client = await createMCPClient({ transport });
  clients.push(client);
  return { client, provider };
}

/** A JWT's claims, unverified: what the client would see. */
function decodeJwt(token: string): Row {
  return JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
  );
}

describe("MCP OAuth", () => {
  it.each([
    { name: "Claude Code", redirectUri: REDIRECT_URI, type: "native" },
    { name: "Claude.ai", redirectUri: CLAUDE_AI_REDIRECT_URI, type: "web" },
  ])(
    "signs $name in from a 401 and runs a tool as the person",
    async ({ name, redirectUri, type }) => {
      const { client, provider } = await connectWithOAuth(
        new TestOAuthProvider(name, redirectUri),
      );

      // 401 → protected-resource metadata → AS metadata → register; then, after
      // the browser's authorize and consent, the code for a token, and the MCP
      // request again.
      expect(sent).toEqual([
        "POST /mcp",
        "GET /.well-known/oauth-protected-resource/mcp",
        "GET /.well-known/oauth-authorization-server/auth",
        "POST /auth/oauth2/register",
        "GET /.well-known/oauth-protected-resource/mcp",
        "GET /.well-known/oauth-authorization-server/auth",
        "POST /auth/oauth2/token",
        "POST /mcp",
      ]);

      // Registered as a public client (no secret), capped at the MCP scopes
      // and linked to the MCP resource.
      const registered = store.oauthClient.find(
        (row) => row.clientId === provider.client?.client_id,
      );
      expect(registered).toMatchObject({
        applicationType: type,
        tokenEndpointAuthMethod: "none",
        scopes: MCP_SCOPES,
      });
      expect(registered?.clientSecret).toBeUndefined();
      expect(store.oauthClientResource).toContainEqual(
        expect.objectContaining({
          clientId: registered?.clientId,
          resourceId: MCP,
        }),
      );

      // A 15-minute JWT for the MCP resource.
      const tokens = provider.saved;
      expect(tokens).toMatchObject({ token_type: "Bearer", expires_in: 900 });
      const claims = decodeJwt(tokens?.access_token ?? "");
      expect([claims.aud].flat()).toContain(MCP);
      expect(claims.iss).toBe(`${CORE}/auth`);
      expect(String(claims.scope).split(" ")).toContain(OAUTH_SCOPE_MCP);

      const me = await client.callTool({
        name: "users_get",
        arguments: { id: "me" },
      });
      expect(me.isError).toBeFalsy();
      expect(me.structuredContent).toEqual({
        data: expect.objectContaining({
          id: store.user[0].id,
          email: "agent-owner@example.test",
        }),
      });
    },
    30_000,
  );

  it("refuses the MCP token at /v1", async () => {
    const { provider } = await connectWithOAuth();

    const response = await app.request(`${CORE}/v1/users/me`, {
      headers: { authorization: `Bearer ${provider.saved?.access_token}` },
    });

    expect(response.status).toBe(401);
  }, 30_000);

  it("refuses an opaque sokosumi:api token at /mcp", async () => {
    const now = new Date();
    store.oauthClient.push({
      id: randomUUID(),
      clientId: API_CLIENT_ID,
      applicationType: "native",
      disabled: false,
      skipConsent: true,
      tokenEndpointAuthMethod: "none",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      redirectUris: [REDIRECT_URI],
      scopes: API_SCOPES,
      createdAt: now,
      updatedAt: now,
    });
    const accessToken = await issueApiToken();

    // The token works where it belongs...
    const v1 = await app.request(`${CORE}/v1/users/me`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(v1.status).toBe(200);

    // ...and not at the MCP server.
    const mcp = await app.request(`${CORE}/mcp`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(mcp.status).toBe(401);
    expect(mcp.headers.get("WWW-Authenticate")).toContain(
      'error="invalid_token"',
    );
  });
});

/** The CLI's sign-in: PKCE without a `resource`, so an opaque token. */
async function issueApiToken(): Promise<string> {
  const verifier = "fixture-pkce-verifier-long-enough-for-validation";
  const query = new URLSearchParams({
    client_id: API_CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: API_SCOPES.join(" "),
    state: "cli-state",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  const authorize = await app.request(
    `${CORE}/auth/oauth2/authorize?${query}`,
    {
      headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    },
  );
  const code = new URL(
    authorize.headers.get("location") ?? "",
  ).searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await app.request(`${CORE}/auth/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code ?? "",
      redirect_uri: REDIRECT_URI,
      client_id: API_CLIENT_ID,
      code_verifier: verifier,
    }),
  });
  expect(token.status).toBe(200);
  const { access_token: accessToken } = (await token.json()) as {
    access_token: string;
  };
  expect(accessToken.startsWith(OAUTH_ACCESS_TOKEN_PREFIX)).toBe(true);
  return accessToken;
}
