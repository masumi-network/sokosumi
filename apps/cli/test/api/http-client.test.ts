import assert from "node:assert/strict";
import test from "node:test";
import {
  createApiError,
  createCoreHttpClient,
} from "../../src/api/http-client.js";
import {
  type AuthEnvironment,
  AuthManager,
} from "../../src/auth/auth-manager.js";

function createManager(environment: AuthEnvironment = {}) {
  return new AuthManager({
    environment,
    credentialStore: {
      read: () => ({ authToken: "stored-token" }),
      write: () => {},
      clear: () => {},
    },
    apiKeyStore: {
      read: () => null,
      write: () => {},
      clear: () => {},
    },
  });
}

test("prefers an explicit environment token over stored credentials", async () => {
  let requestHeaders: Headers | undefined;
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test/",
    authManager: createManager(),
    environment: { SOKOSUMI_AUTH_TOKEN: "environment-token" },
    fetchImpl: async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });

  await client.get("/v1/agents");

  assert.equal(
    requestHeaders?.get("authorization"),
    "Bearer environment-token",
  );
});

test("uses an explicit environment API key through AuthManager", async () => {
  let authorization = "";
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test",
    authManager: createManager(),
    environment: { SOKOSUMI_API_KEY: "environment-api-key" },
    fetchImpl: async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    },
  });

  await client.get("/v1/agents");

  assert.equal(authorization, "Bearer environment-api-key");
});

test("joins URL segments and sends JSON with the requested method", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test///",
    authManager: createManager({}),
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  await client.patch("///v1/agents/agent-1", { name: "Updated" });

  assert.equal(requestUrl, "https://api.example.test/v1/agents/agent-1");
  assert.equal(requestInit?.method, "PATCH");
  assert.equal(requestInit?.headers instanceof Headers, true);
  assert.equal(
    new Headers(requestInit?.headers).get("content-type"),
    "application/json",
  );
  assert.equal(requestInit?.body, JSON.stringify({ name: "Updated" }));
});

test("PUT forwards JSON, selected target, auth, and cancellation", async () => {
  const controller = new AbortController();
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com/",
    authManager: createManager(),
    environment: { SOKOSUMI_AUTH_TOKEN: "preprod-session-token" },
    fetchImpl: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return new Response(JSON.stringify({ data: { updated: true } }));
    },
  });

  const result = await client.put(
    "/v1/organizations/org-1/design-md",
    { designMd: "Design" },
    controller.signal,
  );

  assert.deepEqual(result, { data: { updated: true } });
  assert.equal(
    requestUrl,
    "https://api.preprod.sokosumi.com/v1/organizations/org-1/design-md",
  );
  assert.equal(requestInit?.method, "PUT");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("authorization"), "Bearer preprod-session-token");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(requestInit?.body, '{"designMd":"Design"}');
  assert.equal(requestInit?.signal, controller.signal);
});

test("PUT supports Seat assignment without a request body", async () => {
  let requestInit: RequestInit | undefined;
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com",
    authManager: createManager(),
    fetchImpl: async (_input, init) => {
      requestInit = init;
      return new Response(
        JSON.stringify({
          data: {
            memberId: "member-1",
            seatAssignedAt: "2026-09-27T12:00:00.000Z",
          },
        }),
      );
    },
  });

  await client.put(
    "/v1/admin/organizations/hackathon/members/member-1/seat",
    undefined,
  );

  assert.equal(requestInit?.method, "PUT");
  assert.equal(requestInit?.body, undefined);
  assert.equal(new Headers(requestInit?.headers).has("content-type"), false);
});

test("PUT preserves Core errors and request IDs while redacting credentials", async () => {
  const token = "put-session-secret";
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com",
    authManager: createManager(),
    environment: { SOKOSUMI_AUTH_TOKEN: token },
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: `No unused seats available. ${token}`,
          token: "response-token-secret",
          meta: { requestId: "seat-request-1" },
        }),
        { status: 400 },
      ),
  });

  await assert.rejects(
    client.put(
      "/v1/admin/organizations/hackathon/members/member-1/seat",
      undefined,
    ),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal("status" in error && error.status, 400);
      assert.equal(error.name, "CoreApiError");
      assert.match(error.message, /No unused seats available/);
      assert.match(error.message, /seat-request-1/);
      assert.doesNotMatch(
        error.message,
        /put-session-secret|response-token-secret/,
      );
      assert.doesNotMatch(
        JSON.stringify(error),
        /put-session-secret|response-token-secret/,
      );
      return true;
    },
  );
});

test("recursively redacts credential-shaped error fields", async () => {
  const credential = "very-secret-token";
  const nestedAccessToken = "nested-access-token";
  const nestedRefreshToken = "nested-refresh-token";
  const embeddedApiKey = "embedded-api-key";
  const embeddedRefreshToken = "embedded-refresh-token";
  const bearerSecret = "bearer-secret";
  const quotedApiKey = "quoted api key";
  const quotedRefreshToken = "quoted refresh token";
  const adjacentApiKey = "adjacent-api-key";
  const adjacentRefreshToken = "adjacent-refresh-token";
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test",
    authManager: createManager({ SOKOSUMI_AUTH_TOKEN: credential }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: credential,
          authorization: credential,
          accessToken: nestedAccessToken,
          details: [
            {
              refreshToken: nestedRefreshToken,
              note: "ordinary detail",
              diagnostic: `API__KEY=${embeddedApiKey} REFRESH--TOKEN=${embeddedRefreshToken}; authorization=Bearer ${bearerSecret}; apiKey="${quotedApiKey}" refreshToken='${quotedRefreshToken}'; apiKey=${adjacentApiKey},refreshToken=${adjacentRefreshToken} ordinary detail`,
            },
          ],
          reason: "denied",
        }),
        { status: 403 },
      ),
  });

  await assert.rejects(
    () => client.get("/v1/agents"),
    (error: Error & { status?: number }) => {
      const serialized = JSON.stringify(error);
      assert.equal(error.status, 403);
      assert.match(error.message, /403/);
      assert.match(error.message, /denied/);
      assert.match(error.message, /ordinary detail/);
      for (const secret of [
        credential,
        nestedAccessToken,
        nestedRefreshToken,
        embeddedApiKey,
        embeddedRefreshToken,
        bearerSecret,
        quotedApiKey,
        quotedRefreshToken,
        adjacentApiKey,
        adjacentRefreshToken,
      ]) {
        assert.doesNotMatch(error.message, new RegExp(secret));
        assert.doesNotMatch(serialized, new RegExp(secret));
      }
      assert.match(serialized, /ordinary detail/);
      return true;
    },
  );
});

test("reports invalid JSON responses explicitly", async () => {
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test",
    authManager: createManager({}),
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });

  await assert.rejects(
    () => client.get("/v1/agents"),
    /Core API returned invalid JSON \(status 200\)/,
  );
});

test("createApiError redacts credential-shaped keys across casing and nesting", () => {
  const error = createApiError(401, {
    authorization: "body-value-01",
    accessToken: "body-value-02",
    "refresh-token": "body-value-03",
    auth_token: "body-value-04",
    clientSecret: "body-value-05",
    apiKey: "body-value-06",
    password: "body-value-07",
    message: "Unauthorized",
    details: [
      {
        "client-secret": "body-value-08",
        api_key: "body-value-09",
        note: "ordinary detail",
      },
    ],
  }) as Error & { status?: number; body?: unknown };
  const serialized = JSON.stringify(error);

  assert.equal(error.status, 401);
  assert.match(error.message, /Unauthorized/);
  assert.match(error.message, /ordinary detail/);
  assert.match(serialized, /Unauthorized/);
  assert.match(serialized, /ordinary detail/);
  for (const secret of [
    "body-value-01",
    "body-value-02",
    "body-value-03",
    "body-value-04",
    "body-value-05",
    "body-value-06",
    "body-value-07",
    "body-value-08",
    "body-value-09",
  ]) {
    assert.doesNotMatch(error.message, new RegExp(secret));
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
  assert.deepEqual(error.body, {
    authorization: "[REDACTED]",
    accessToken: "[REDACTED]",
    "refresh-token": "[REDACTED]",
    auth_token: "[REDACTED]",
    clientSecret: "[REDACTED]",
    apiKey: "[REDACTED]",
    password: "[REDACTED]",
    message: "Unauthorized",
    details: [
      {
        "client-secret": "[REDACTED]",
        api_key: "[REDACTED]",
        note: "ordinary detail",
      },
    ],
  });
});
test("redacts dotted and spaced credential separators", () => {
  const dottedSecret = "dotted-api-key";
  const spacedSecret = "spaced-refresh-token";
  const error = createApiError(401, {
    "API.KEY": dottedSecret,
    "refresh token": spacedSecret,
    message: "API.KEY=dotted-api-key REFRESH TOKEN=spaced-refresh-token",
  }) as Error & { body?: unknown };

  assert.doesNotMatch(error.message, new RegExp(dottedSecret));
  assert.doesNotMatch(error.message, new RegExp(spacedSecret));
  assert.deepEqual(error.body, {
    "API.KEY": "[REDACTED]",
    "refresh token": "[REDACTED]",
    message: "API.KEY: [REDACTED] REFRESH TOKEN: [REDACTED]",
  });
});
