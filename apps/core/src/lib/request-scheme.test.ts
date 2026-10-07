import { createHash } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { oauthProvider } from "@better-auth/oauth-provider";
import { serve } from "@hono/node-server";
import { memoryAdapter } from "better-auth/adapters/memory";
import { betterAuth } from "better-auth/minimal";
import { jwt } from "better-auth/plugins";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { asServedOnVercel } from "@/test-fixtures/served-on-vercel";
import { withPublicScheme } from "./request-scheme";

const ISSUER = "https://api.example.com";
const TOKEN_URL = `${ISSUER}/auth/oauth2/token`;
const USERINFO_URL = `${ISSUER}/auth/oauth2/userinfo`;
const CLIENT_ID = "dpop-client";
const USER_ID = "user-1";
const SEED_REFRESH_TOKEN = "seed-refresh-token";

describe("withPublicScheme", () => {
  it.each(["production", "preview"] as const)(
    "restores HTTPS on a %s deployment and keeps the rest of the request",
    async (vercelEnv) => {
      const served = new Request(
        asServedOnVercel(`${ISSUER}/v1/tasks?cursor=abc`),
        {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": "key" },
          body: JSON.stringify({ name: "Ada" }),
        },
      );

      const request = withPublicScheme(served, vercelEnv);

      expect(request.url).toBe(`${ISSUER}/v1/tasks?cursor=abc`);
      expect(request.method).toBe("POST");
      expect(request.headers.get("x-api-key")).toBe("key");
      expect(await request.json()).toEqual({ name: "Ada" });
    },
  );

  it.each(["development", undefined] as const)(
    "leaves the request alone when VERCEL_ENV is %s",
    (vercelEnv) => {
      const served = new Request("http://localhost:8787/v1/tasks");

      expect(withPublicScheme(served, vercelEnv)).toBe(served);
    },
  );

  it("ignores a forwarded scheme off Vercel", () => {
    const served = new Request("http://localhost:8787/v1/tasks", {
      headers: { "x-forwarded-proto": "https" },
    });

    expect(withPublicScheme(served, undefined).url).toBe(
      "http://localhost:8787/v1/tasks",
    );
  });
});

/**
 * `@hono/node-server` on a plain socket behind Core's entry wrapper, which is
 * how Vercel runs it. Its request object is not a native `Request`, so the
 * wrapper has to be tried against the real thing.
 */
async function listen(app: Hono, vercelEnv: "production" | undefined) {
  const server = serve({
    fetch: (request, bindings) =>
      app.fetch(withPublicScheme(request, vercelEnv), bindings),
    port: 0,
    hostname: "127.0.0.1",
  });
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;

  return {
    request(
      method: string,
      path: string,
      onResponse: (incoming: IncomingMessage) => void,
    ) {
      return httpRequest(
        {
          host: "127.0.0.1",
          port,
          method,
          path,
          headers: { host: "api.example.com" },
        },
        onResponse,
      );
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function createEchoApp(): Hono {
  const app = new Hono();
  app.all("*", async (c) =>
    c.json({ url: c.req.url, body: await c.req.text() }),
  );
  return app;
}

/** Sends one request and resolves with what the echo app saw. */
async function echo(
  vercelEnv: "production" | undefined,
  options: { method: string; path: string; body?: string },
): Promise<{ status: number; seen: { url: string; body: string } }> {
  const server = await listen(createEchoApp(), vercelEnv);
  try {
    return await new Promise((resolve, reject) => {
      const outgoing = server.request(
        options.method,
        options.path,
        (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            body += chunk;
          });
          incoming.on("end", () =>
            resolve({
              status: incoming.statusCode ?? 0,
              seen: JSON.parse(body),
            }),
          );
        },
      );
      outgoing.on("error", reject);
      outgoing.end(options.body);
    });
  } finally {
    await server.close();
  }
}

describe("withPublicScheme behind @hono/node-server", () => {
  it("shows the socket's scheme without it", async () => {
    const { seen } = await echo(undefined, {
      method: "GET",
      path: "/v1/tasks",
    });

    expect(seen.url).toBe("http://api.example.com/v1/tasks");
  });

  it("gives the app the HTTPS URL and the request body", async () => {
    const { status, seen } = await echo("production", {
      method: "POST",
      path: "/v1/tasks?cursor=abc",
      body: "name=Ada",
    });

    expect(status).toBe(200);
    expect(seen).toEqual({
      url: "https://api.example.com/v1/tasks?cursor=abc",
      body: "name=Ada",
    });
  });

  it("still answers a method the Fetch API cannot construct", async () => {
    const { status } = await echo("production", {
      method: "TRACE",
      path: "/v1/tasks",
    });

    expect(status).toBe(200);
  });

  it("still tells the app when the client disconnects", async () => {
    const aborted = Promise.withResolvers<void>();
    const app = new Hono();
    app.get("*", (c) => {
      c.req.raw.signal.addEventListener("abort", () => aborted.resolve());
      // Never closes: only the client going away can end it.
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("first chunk"));
          },
        }),
      );
    });
    const server = await listen(app, "production");

    const outgoing = server.request("GET", "/v1/stream", (incoming) => {
      incoming.once("data", () => outgoing.destroy());
    });
    outgoing.on("error", () => {});
    outgoing.end();

    await aborted.promise;
    await server.close();
  });
});

type MemoryDb = Record<string, Record<string, unknown>[]>;

// The provider stores SHA-256 base64url digests of refresh tokens.
function sha256(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

// Better Auth's own token and userinfo endpoints on an in-memory store, with a
// refresh token to trade in, so the DPoP check is the library's and not a mock.
function createProvider() {
  const now = new Date();
  const db: MemoryDb = {
    user: [
      {
        id: USER_ID,
        email: "ada@example.com",
        name: "Ada",
        emailVerified: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    session: [],
    account: [],
    verification: [],
    jwks: [],
    oauthClient: [
      {
        id: "client-row-1",
        clientId: CLIENT_ID,
        public: true,
        disabled: false,
        tokenEndpointAuthMethod: "none",
        grantTypes: ["authorization_code", "refresh_token"],
        redirectUris: ["https://client.example.com/callback"],
        createdAt: now,
        updatedAt: now,
      },
    ],
    oauthAccessToken: [],
    oauthRefreshToken: [
      {
        id: "refresh-row-1",
        token: sha256(SEED_REFRESH_TOKEN),
        clientId: CLIENT_ID,
        userId: USER_ID,
        scopes: ["openid", "offline_access"],
        createdAt: now,
        expiresAt: new Date(now.getTime() + 86_400_000),
        revoked: null,
      },
    ],
    oauthConsent: [],
  };
  return betterAuth({
    baseURL: ISSUER,
    basePath: "/auth",
    secret: "test-secret-that-is-long-enough-for-better-auth",
    database: memoryAdapter(db),
    plugins: [
      jwt({ disableSettingJwtHeader: true }),
      oauthProvider({
        loginPage: "https://app.example.com/signin",
        consentPage: "https://app.example.com/oauth/consent",
      }),
    ],
    rateLimit: { enabled: false },
  });
}

interface DpopKey {
  privateKey: CryptoKey;
  jwk: JsonWebKey;
}

async function createDpopKey(): Promise<DpopKey> {
  const { privateKey, publicKey } = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", publicKey);
  return { privateKey, jwk: { kty, crv, x, y } };
}

/** An RFC 9449 proof, as a client that only knows the public URL signs it. */
async function signDpopProof(
  key: DpopKey,
  claims: { htm: string; htu: string; ath?: string },
): Promise<string> {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const signingInput = [
    encode({ typ: "dpop+jwt", alg: "ES256", jwk: key.jwk }),
    encode({
      jti: crypto.randomUUID(),
      iat: Math.floor(Date.now() / 1000),
      ...claims,
    }),
  ].join(".");
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key.privateKey,
    Buffer.from(signingInput),
  );
  return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
}

async function tokenRequest(key: DpopKey): Promise<Request> {
  return new Request(asServedOnVercel(TOKEN_URL), {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      dpop: await signDpopProof(key, { htm: "POST", htu: TOKEN_URL }),
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: SEED_REFRESH_TOKEN,
      client_id: CLIENT_ID,
    }).toString(),
  });
}

async function userInfoRequest(
  key: DpopKey,
  accessToken: string,
): Promise<Request> {
  return new Request(asServedOnVercel(USERINFO_URL), {
    headers: {
      authorization: `DPoP ${accessToken}`,
      dpop: await signDpopProof(key, {
        htm: "GET",
        htu: USERINFO_URL,
        ath: sha256(accessToken),
      }),
    },
  });
}

describe("DPoP on the OAuth provider behind Vercel's TLS termination", () => {
  it("rejects a proof for the public token URL while the request stays plain HTTP", async () => {
    const auth = createProvider();
    const key = await createDpopKey();

    const response = await auth.handler(await tokenRequest(key));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "invalid_dpop_proof",
      error_description: "DPoP proof htu does not match the request URL",
    });
  });

  it("binds tokens to the proof once the scheme is restored", async () => {
    const auth = createProvider();
    const key = await createDpopKey();

    const response = await auth.handler(
      withPublicScheme(await tokenRequest(key), "production"),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ token_type: "DPoP" });
  });

  it("serves userinfo to a DPoP-bound token only once the scheme is restored", async () => {
    const auth = createProvider();
    const key = await createDpopKey();
    const issued = await auth.handler(
      withPublicScheme(await tokenRequest(key), "production"),
    );
    const { access_token: accessToken } = (await issued.json()) as {
      access_token: string;
    };

    const plain = await auth.handler(await userInfoRequest(key, accessToken));
    const restored = await auth.handler(
      withPublicScheme(await userInfoRequest(key, accessToken), "production"),
    );

    expect(plain.status).toBe(401);
    expect(await plain.json()).toEqual({
      error: "invalid_dpop_proof",
      error_description: "DPoP proof htu does not match the request URL",
    });
    expect(restored.status).toBe(200);
    expect(await restored.json()).toMatchObject({ sub: USER_ID });
  });
});
