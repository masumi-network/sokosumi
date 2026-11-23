import { createHash, randomUUID } from "node:crypto";
import { oauthProvider } from "@better-auth/oauth-provider";
import {
  OAUTH_PROVIDER_SCOPES,
  OAUTH_SCOPE_CORE_API,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
  OAUTH_SCOPE_OPENID,
} from "@sokosumi/utils";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { errorHandler } from "@/helpers/error-handler";
import { type AuthVariables, authMiddleware } from "@/middleware/auth";

import { verifyMcpAccessToken } from "./auth";
import { mcpOAuthResource, mcpResourceIdentifier } from "./resource";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

// Core's grant checks read Prisma; here they read the rows Better Auth wrote.
const db = vi.hoisted(() => ({ store: {} as Record<string, Row[]> }));
vi.mock("@/lib/db/prisma", () => {
  const find = (model: string, where: Row) =>
    db.store[model]?.find((row) =>
      Object.entries(where).every(([key, value]) => row[key] === value),
    ) ?? null;
  return {
    default: {
      user: {
        findUnique: async ({ where }: { where: Row }) => find("user", where),
      },
      oauthClient: {
        findUnique: async ({ where }: { where: Row }) =>
          find("oauthClient", where),
      },
      oauthConsent: {
        findFirst: async ({ where }: { where: Row }) =>
          find("oauthConsent", where),
      },
      // A JWT is never stored, so `/v1` finds no row for it.
      oauthAccessToken: {
        findUnique: async ({ where }: { where: Row }) =>
          find("oauthAccessToken", where),
      },
    },
  };
});
// `/v1` tries a bearer that is not an OAuth-prefixed token as an API key first.
vi.mock("@/lib/auth", () => ({
  auth: { api: { verifyApiKey: async () => ({ valid: false }) } },
}));

const CORE = "https://core.example.test";
const WEB = "https://web.example.test";
const CLIENT_ID = "mcp-client";
const REDIRECT_URI = "http://127.0.0.1:33418/callback";
const OTHER_RESOURCE = "https://other.example.test/api";
const MCP = mcpResourceIdentifier(CORE);
const CODE_VERIFIER = "fixture-pkce-verifier-long-enough-for-validation";
const CLIENT_SCOPES = [
  OAUTH_SCOPE_OPENID,
  OAUTH_SCOPE_MCP,
  OAUTH_SCOPE_OFFLINE_ACCESS,
];

function createAuth() {
  const now = new Date();
  const store: Store = {
    user: [],
    account: [],
    session: [],
    verification: [],
    jwks: [],
    oauthAccessToken: [],
    oauthRefreshToken: [],
    oauthResource: [],
    oauthClient: [
      {
        id: randomUUID(),
        clientId: CLIENT_ID,
        public: true,
        disabled: false,
        skipConsent: false,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        responseTypes: ["code"],
        redirectUris: [REDIRECT_URI],
        scopes: CLIENT_SCOPES,
        createdAt: now,
        updatedAt: now,
      },
    ],
    // Better Auth links a client to a resource by the resource's identifier.
    oauthClientResource: [MCP, OTHER_RESOURCE].map((resourceId) => ({
      id: randomUUID(),
      clientId: CLIENT_ID,
      resourceId,
      createdAt: now,
    })),
    oauthConsent: [],
  };
  db.store = store;
  const auth = betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: "owned-offline-auth-fixture-secret-32-characters",
    database: memoryAdapter(store),
    trustedOrigins: [WEB, CORE],
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      // Core's MCP settings (`src/lib/auth.ts`), plus a second resource to
      // prove the audience check.
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        scopes: [...OAUTH_PROVIDER_SCOPES, OAUTH_SCOPE_MCP],
        resources: [
          mcpOAuthResource(CORE),
          { identifier: OTHER_RESOURCE, allowedScopes: CLIENT_SCOPES },
        ],
      }),
    ],
    rateLimit: { enabled: false },
  });
  return { auth, store };
}

let auth: ReturnType<typeof createAuth>["auth"];
let store: Store;
let cookie: string;

beforeEach(async () => {
  ({ auth, store } = createAuth());
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
  const userId = store.user[0].id;
  const now = new Date();
  store.oauthConsent.push({
    id: randomUUID(),
    clientId: CLIENT_ID,
    userId,
    referenceId: null,
    scopes: CLIENT_SCOPES,
    // Consent is per resource: a new `resource` asks again.
    resources: [MCP, OTHER_RESOURCE],
    createdAt: now,
    updatedAt: now,
  });
});

/** Authorize with PKCE, then exchange the code, as an MCP client does. */
async function issueAccessToken(options: {
  scope: string;
  resource?: string;
}): Promise<{ access_token: string; expires_in: number }> {
  const query = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: options.scope,
    state: "client-state",
    code_challenge: createHash("sha256")
      .update(CODE_VERIFIER)
      .digest("base64url"),
    code_challenge_method: "S256",
    ...(options.resource ? { resource: options.resource } : {}),
  });
  const authorize = await auth.handler(
    new Request(`${CORE}/auth/oauth2/authorize?${query}`, {
      headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    }),
  );
  const code = new URL(
    authorize.headers.get("location") ?? "",
  ).searchParams.get("code");
  expect(code).toBeTruthy();

  const token = await auth.handler(
    new Request(`${CORE}/auth/oauth2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code ?? "",
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        code_verifier: CODE_VERIFIER,
        ...(options.resource ? { resource: options.resource } : {}),
      }),
    }),
  );
  expect(token.status).toBe(200);
  return await token.json();
}

/** A JWT's claims, unverified: what the client would see. */
function decodeJwt(token: string): Row {
  return JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
  );
}

const MCP_SCOPE = `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_MCP} ${OAUTH_SCOPE_OFFLINE_ACCESS}`;

describe("verifyMcpAccessToken", () => {
  it("accepts a 15-minute JWT whose audience is the MCP resource", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE, resource: MCP });

    expect(token.expires_in).toBe(900);
    const claims = decodeJwt(token.access_token);
    expect([claims.aud].flat()).toContain(MCP);
    expect(claims.iss).toBe(`${CORE}/auth`);

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "active",
      authContext: {
        actor: "user",
        userId: store.user[0].id,
        organizationId: null,
        role: "user",
        authenticationMethod: "oauth",
        oauthClientId: CLIENT_ID,
      },
    });
  });

  it("drops sokosumi:api from a token for the MCP resource", async () => {
    // A client allowed both, such as the CLI, asking for both.
    for (const row of [store.oauthClient[0], store.oauthConsent[0]]) {
      row.scopes = [...CLIENT_SCOPES, OAUTH_SCOPE_CORE_API];
    }
    const token = await issueAccessToken({
      scope: `${MCP_SCOPE} ${OAUTH_SCOPE_CORE_API}`,
      resource: MCP,
    });

    expect(decodeJwt(token.access_token).scope).toBe(MCP_SCOPE);
  });

  it("rejects a JWT for another resource", async () => {
    const token = await issueAccessToken({
      scope: MCP_SCOPE,
      resource: OTHER_RESOURCE,
    });

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "invalid_token",
    });
  });

  it("rejects an opaque token", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE });

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "invalid_token",
    });
  });

  it("answers insufficient_scope for a token without sokosumi:mcp", async () => {
    const token = await issueAccessToken({
      scope: `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_OFFLINE_ACCESS}`,
      resource: MCP,
    });

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "insufficient_scope",
    });
  });

  it("rejects the token of a user banned after it was issued", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE, resource: MCP });
    store.user[0].banned = true;

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "invalid_token",
    });
  });

  it("rejects the token once the user withdraws consent", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE, resource: MCP });
    store.oauthConsent.length = 0;

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "invalid_token",
    });
  });

  it("rejects the token of a client disabled after it was issued", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE, resource: MCP });
    store.oauthClient[0].disabled = true;

    await expect(
      verifyMcpAccessToken(token.access_token, auth),
    ).resolves.toEqual({
      status: "invalid_token",
    });
  });
});

describe("Core /v1", () => {
  it("rejects an MCP token", async () => {
    const token = await issueAccessToken({ scope: MCP_SCOPE, resource: MCP });
    const app = new Hono<{ Variables: AuthVariables }>();
    app.use("*", authMiddleware);
    app.get("/", (c) => c.json(c.var.authContext));
    app.onError(errorHandler);

    const response = await app.request("/", {
      headers: { authorization: `Bearer ${token.access_token}` },
    });

    expect(response.status).toBe(401);
  });
});
