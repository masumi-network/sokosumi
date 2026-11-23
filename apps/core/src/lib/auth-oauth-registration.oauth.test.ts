import { createHash } from "node:crypto";
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
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  mcpOAuthResource,
  mcpResourceIdentifier,
} from "@/lib/sokosumi-mcp/resource";

import { afterAuthRequest } from "./auth-new-session";
import {
  applyOAuthClientPolicy,
  clientRegistrationOptions,
  markSelfRegisteredClient,
} from "./auth-oauth-provider";

type Row = Record<string, unknown>;
type Store = Record<string, Row[]>;

const CORE = "https://core.example.test";
const WEB = "https://web.example.test";
const MCP = mcpResourceIdentifier(CORE);
const LOOPBACK_REDIRECT = "http://localhost:33418/callback";
const WEB_REDIRECT = "https://agent.example.test/callback";
const CODE_VERIFIER = "fixture-pkce-verifier-long-enough-for-validation";
const MCP_SCOPE = `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_MCP} ${OAUTH_SCOPE_OFFLINE_ACCESS}`;
const registration = clientRegistrationOptions(MCP);

/** Core's provider settings (`src/lib/auth.ts`) on an in-memory store. */
function createAuth(options: { rateLimit?: boolean } = {}) {
  const store: Store = {
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
  const auth = betterAuth({
    baseURL: CORE,
    basePath: "/auth",
    secret: "owned-offline-auth-fixture-secret-32-characters",
    database: memoryAdapter(store),
    trustedOrigins: [WEB, CORE],
    emailAndPassword: { enabled: true },
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: `${WEB}/signin`,
        consentPage: `${WEB}/oauth/consent`,
        allowPublicClientPrelogin: true,
        scopes: [...OAUTH_PROVIDER_SCOPES, OAUTH_SCOPE_MCP],
        resources: [mcpOAuthResource(CORE)],
        grantTypes: ["authorization_code", "refresh_token"],
        ...registration,
      }),
    ],
    // Core's own hook steps (`src/lib/auth.ts`), in Core's order.
    hooks: {
      before: createAuthMiddleware(async (ctx) =>
        applyOAuthClientPolicy(ctx, MCP),
      ),
      after: createAuthMiddleware(async (ctx) => afterAuthRequest(ctx)),
    },
    rateLimit: options.rateLimit
      ? { enabled: true, storage: "memory" }
      : { enabled: false },
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
});

/** `POST /oauth2/register` without a session, as an MCP client sends it. */
async function register(
  body: Row,
  target: ReturnType<typeof createAuth>["auth"] = auth,
) {
  return await target.handler(
    new Request(`${CORE}/auth/oauth2/register`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.7",
      },
      body: JSON.stringify(body),
    }),
  );
}

const MCP_CLIENT = {
  client_name: "Claude Code",
  redirect_uris: [LOOPBACK_REDIRECT],
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
  token_endpoint_auth_method: "none",
};

async function registerMcpClient(): Promise<string> {
  const response = await register(MCP_CLIENT);
  expect(response.status).toBe(201);
  const client: { client_id: string } = await response.json();
  return client.client_id;
}

/**
 * Authorize as the signed-in user, accepting the consent page when it shows.
 * Returns the code, or the error the provider redirected back with.
 */
async function authorize(options: {
  clientId: string;
  redirectUri: string;
  scope: string;
  resource?: string;
  pkce?: boolean;
}): Promise<{
  code: string | null;
  error: string | null;
  description: string | null;
}> {
  const query = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: "code",
    scope: options.scope,
    state: "client-state",
    ...(options.pkce === false
      ? {}
      : {
          code_challenge: createHash("sha256")
            .update(CODE_VERIFIER)
            .digest("base64url"),
          code_challenge_method: "S256",
        }),
    ...(options.resource ? { resource: options.resource } : {}),
  });
  const response = await auth.handler(
    new Request(`${CORE}/auth/oauth2/authorize?${query}`, {
      headers: { cookie, accept: "text/html", "sec-fetch-mode": "navigate" },
    }),
  );
  let location = new URL(response.headers.get("location") ?? "");
  if (location.href.startsWith(`${WEB}/oauth/consent`)) {
    const consent = await auth.handler(
      new Request(`${CORE}/auth/oauth2/consent`, {
        method: "POST",
        headers: { cookie, origin: WEB, "content-type": "application/json" },
        body: JSON.stringify({
          accept: true,
          oauth_query: location.search.slice(1),
        }),
      }),
    );
    expect(consent.status).toBe(200);
    const { url }: { url: string } = await consent.json();
    location = new URL(url);
  }
  return {
    code: location.searchParams.get("code"),
    error: location.searchParams.get("error"),
    description: location.searchParams.get("error_description"),
  };
}

async function exchangeCode(
  body: Record<string, string>,
  headers: Record<string, string> = {},
) {
  const response = await auth.handler(
    new Request(`${CORE}/auth/oauth2/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...headers,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code_verifier: CODE_VERIFIER,
        ...body,
      }),
    }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as {
    access_token: string;
    refresh_token?: string;
    scope: string;
  };
}

function decodeJwt(token: string): Row {
  return JSON.parse(
    Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
  );
}

describe("dynamic client registration", () => {
  it("registers a public PKCE client linked to the MCP resource", async () => {
    const response = await register(MCP_CLIENT);

    expect(response.status).toBe(201);
    const client: Row = await response.json();
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(client.scope).toBe(MCP_SCOPE);
    expect(store.oauthClient).toHaveLength(1);
    expect(store.oauthClient[0]).toMatchObject({
      clientId: client.client_id,
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
      scopes: MCP_SCOPE.split(" "),
    });
    // Nobody owns it: no user and no secret.
    expect(store.oauthClient[0]).not.toHaveProperty("userId");
    expect(store.oauthClient[0]).not.toHaveProperty("clientSecret");
    expect(store.oauthClientResource).toEqual([
      expect.objectContaining({ clientId: client.client_id, resourceId: MCP }),
    ]);
  });

  it("registers a client that asks for a secret as a public client", async () => {
    const response = await register({
      client_name: "Hosted agent",
      redirect_uris: [WEB_REDIRECT],
      token_endpoint_auth_method: "client_secret_post",
    });

    expect(response.status).toBe(201);
    const client: Row = await response.json();
    expect(client.client_secret).toBeUndefined();
    expect(client.token_endpoint_auth_method).toBe("none");
  });

  it.each([
    ["backchannel_logout_uri", "https://agent.example.test/logout"],
    ["jwks_uri", "https://agent.example.test/jwks.json"],
    ...["client_uri", "logo_uri", "tos_uri", "policy_uri"].map((field) => [
      field,
      "javascript:alert(1)",
    ]),
    ["logo_uri", "http://agent.example.test/logo.png"],
  ])("refuses a registration with %s %s", async (field, value) => {
    const response = await register({ ...MCP_CLIENT, [field]: value });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "invalid_client_metadata",
    });
    expect(store.oauthClient).toHaveLength(0);
  });

  it("refuses a registration that asks for sokosumi:api", async () => {
    const response = await register({
      ...MCP_CLIENT,
      scope: `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_CORE_API}`,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
    expect(store.oauthClient).toHaveLength(0);
  });

  it.each([
    ["without a resource", undefined],
    ["for the MCP resource", MCP],
  ])("never authorizes sokosumi:api %s", async (_label, resource) => {
    const clientId = await registerMcpClient();

    const result = await authorize({
      clientId,
      redirectUri: LOOPBACK_REDIRECT,
      scope: `${MCP_SCOPE} ${OAUTH_SCOPE_CORE_API}`,
      resource,
    });

    expect(result).toMatchObject({ code: null, error: "invalid_scope" });
  });

  it("refuses to authorize without PKCE", async () => {
    const clientId = await registerMcpClient();

    const result = await authorize({
      clientId,
      redirectUri: LOOPBACK_REDIRECT,
      scope: MCP_SCOPE,
      resource: MCP,
      pkce: false,
    });

    expect(result).toEqual({
      code: null,
      error: "invalid_request",
      description: expect.stringMatching(/pkce|code_challenge/i),
    });
  });

  it("gets an MCP token through authorize, consent and the token endpoint", async () => {
    const clientId = await registerMcpClient();

    const { code } = await authorize({
      clientId,
      redirectUri: LOOPBACK_REDIRECT,
      scope: MCP_SCOPE,
      resource: MCP,
    });
    const token = await exchangeCode({
      code: code ?? "",
      client_id: clientId,
      redirect_uri: LOOPBACK_REDIRECT,
      resource: MCP,
    });

    const claims = decodeJwt(token.access_token);
    expect([claims.aud].flat()).toContain(MCP);
    expect(claims.scope).toBe(MCP_SCOPE);
    expect(token.refresh_token).toBeTruthy();
  });

  it("limits registrations per IP address", async () => {
    const { auth: limited } = createAuth({ rateLimit: true });
    const { max } = registration.rateLimit.register;

    for (let attempt = 0; attempt < max; attempt++) {
      expect((await register(MCP_CLIENT, limited)).status).toBe(201);
    }

    expect((await register(MCP_CLIENT, limited)).status).toBe(429);
  });
});

/** Web's create-client with the signed-in user as owner. */
async function createOwnedClient(scope: string) {
  const created = await auth.handler(
    new Request(`${CORE}/auth/oauth2/create-client`, {
      method: "POST",
      headers: { cookie, origin: WEB, "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Partner app",
        redirect_uris: [WEB_REDIRECT],
        scope,
        grant_types: ["authorization_code", "refresh_token"],
      }),
    }),
  );
  expect(created.status).toBe(201);
  return (await created.json()) as {
    client_id: string;
    client_secret?: string;
  };
}

/** What Web's consent page and sign-in page read about a client. */
async function readPublicClient(clientId: string, redirectUri: string) {
  // The sign-in page gets a signed query when authorize finds no session.
  const signIn = await auth.handler(
    new Request(
      `${CORE}/auth/oauth2/authorize?${new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: OAUTH_SCOPE_OPENID,
        code_challenge: createHash("sha256")
          .update(CODE_VERIFIER)
          .digest("base64url"),
        code_challenge_method: "S256",
      })}`,
      { headers: { accept: "text/html", "sec-fetch-mode": "navigate" } },
    ),
  );
  const oauthQuery = new URL(signIn.headers.get("location") ?? "").search.slice(
    1,
  );
  const [publicClient, prelogin] = await Promise.all([
    auth.handler(
      new Request(
        `${CORE}/auth/oauth2/public-client?${new URLSearchParams({ client_id: clientId })}`,
        { headers: { cookie } },
      ),
    ),
    auth.handler(
      new Request(`${CORE}/auth/oauth2/public-client-prelogin`, {
        method: "POST",
        headers: { origin: WEB, "content-type": "application/json" },
        body: JSON.stringify({ client_id: clientId, oauth_query: oauthQuery }),
      }),
    ),
  ]);
  return [await publicClient.json(), await prelogin.json()] as Row[];
}

describe("sokosumi:mcp outside self-registration", () => {
  it("refuses it when Web creates a client", async () => {
    const response = await auth.handler(
      new Request(`${CORE}/auth/oauth2/create-client`, {
        method: "POST",
        headers: { cookie, origin: WEB, "content-type": "application/json" },
        body: JSON.stringify({
          client_name: "Partner app",
          redirect_uris: [WEB_REDIRECT],
          scope: MCP_SCOPE,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_scope" });
    expect(store.oauthClient).toHaveLength(0);
  });

  it("refuses it when Web updates a client", async () => {
    const { client_id } = await createOwnedClient(OAUTH_SCOPE_OPENID);

    const response = await auth.handler(
      new Request(`${CORE}/auth/oauth2/update-client`, {
        method: "POST",
        headers: { cookie, origin: WEB, "content-type": "application/json" },
        body: JSON.stringify({ client_id, update: { scope: MCP_SCOPE } }),
      }),
    );

    expect(response.status).toBe(400);
    expect(store.oauthClient[0].scopes).toEqual([OAUTH_SCOPE_OPENID]);
  });

  it("leaves a client Web creates unlinked from the MCP resource", async () => {
    await createOwnedClient(OAUTH_SCOPE_OPENID);

    expect(store.oauthClientResource).toEqual([]);
  });
});

describe("public client info", () => {
  it("marks a self-registered client", async () => {
    const clientId = await registerMcpClient();

    for (const client of await readPublicClient(clientId, LOOPBACK_REDIRECT)) {
      expect(client).toMatchObject({
        client_id: clientId,
        client_name: "Claude Code",
        selfRegistered: true,
      });
    }
  });

  it("marks a client created on Web as owned", async () => {
    const { client_id } = await createOwnedClient(OAUTH_SCOPE_OPENID);

    for (const client of await readPublicClient(client_id, WEB_REDIRECT)) {
      expect(client).toMatchObject({ client_id, selfRegistered: false });
    }
  });

  it("treats a client it cannot read as self-registered", async () => {
    const logger = { error: vi.fn() };
    const ctx = {
      path: "/oauth2/public-client",
      json: (body: unknown) => body,
      context: {
        returned: { client_id: "c1", client_name: "Agent" },
        logger,
        adapter: {
          findOne: async () => {
            throw new Error("database unavailable");
          },
        },
      },
    } as unknown as Parameters<typeof markSelfRegisteredClient>[0];

    await expect(markSelfRegisteredClient(ctx)).resolves.toEqual({
      client_id: "c1",
      client_name: "Agent",
      selfRegistered: true,
    });
    expect(logger.error).toHaveBeenCalled();
  });

  it("still answers 404 for an unknown client", async () => {
    const response = await auth.handler(
      new Request(`${CORE}/auth/oauth2/public-client?client_id=missing`, {
        headers: { cookie },
      }),
    );

    expect(response.status).toBe(404);
  });
});

describe("Web's create-client", () => {
  it("still grants Sokosumi API access when ticked", async () => {
    // What `use-oauth-clients.ts` sends with "Allow Sokosumi API access".
    const scope = `${OAUTH_SCOPE_OPENID} ${OAUTH_SCOPE_CORE_API} ${OAUTH_SCOPE_OFFLINE_ACCESS}`;
    const client = await createOwnedClient(scope);
    expect(client.client_secret).toBeTruthy();

    const { code } = await authorize({
      clientId: client.client_id,
      redirectUri: WEB_REDIRECT,
      scope,
    });
    const credentials = `${client.client_id}:${client.client_secret}`;
    const token = await exchangeCode(
      { code: code ?? "", redirect_uri: WEB_REDIRECT },
      { authorization: `Basic ${Buffer.from(credentials).toString("base64")}` },
    );

    expect(token.scope.split(" ")).toContain(OAUTH_SCOPE_CORE_API);
  });
});
