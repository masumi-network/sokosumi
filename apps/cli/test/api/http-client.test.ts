import assert from "node:assert/strict";
import test from "node:test";
import {
  createApiError,
  createCoreHttpClient,
  createCoworkerHttpClient,
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

test("Core client sends an explicit organization slug on every HTTP method", async () => {
  const requests: RequestInit[] = [];
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com",
    authManager: createManager(),
    organizationSlug: "  developer-team_ab-12  ",
    fetchImpl: async (_input, init) => {
      requests.push(init ?? {});
      return new Response("{}");
    },
  });

  await client.get("/v1/tasks");
  await client.post("/v1/tasks", { description: "Hello" });
  await client.patch("/v1/tasks/task-1", { name: "Updated" });
  await client.put("/v1/tasks/task-1/workspace", { organizationId: "org-1" });

  assert.deepEqual(
    requests.map((request) => request.method),
    ["GET", "POST", "PATCH", "PUT"],
  );
  for (const request of requests) {
    const headers = new Headers(request.headers);
    assert.equal(headers.get("x-organization-slug"), "developer-team_ab-12");
    assert.equal(headers.get("authorization"), "Bearer stored-token");
  }
});

test("Core client omits organization selection by default", async () => {
  let headers: Headers | undefined;
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com",
    authManager: createManager(),
    fetchImpl: async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response("{}");
    },
  });
  await client.post("/v1/tasks", { description: "Personal Task" });
  assert.equal(headers?.has("x-organization-slug"), false);
});

test("Core client rejects unsafe organization slugs before authentication or HTTP", (context) => {
  const authManager = createManager();
  const tokenLookup = context.mock.method(
    authManager,
    "getAuthTokenAsync",
    async () => {
      throw new Error("Unexpected authentication");
    },
  );
  let requests = 0;
  for (const organizationSlug of [
    "",
    "   ",
    ".",
    "..",
    "team/name",
    "team\\name",
    "team%20name",
    "team name",
    "team\tname",
    "team\n",
    "\u200bteam",
    "team?x=1",
    "team#other",
    "équipe",
  ]) {
    assert.throws(
      () =>
        createCoreHttpClient({
          apiUrl: "https://api.preprod.sokosumi.com",
          authManager,
          organizationSlug,
          fetchImpl: async () => {
            requests++;
            return new Response("{}");
          },
        }),
      /Organization slug must contain only/,
    );
  }
  assert.equal(tokenLookup.mock.callCount(), 0);
  assert.equal(requests, 0);
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

test("Coworker runtime never inherits organization selection", async () => {
  const previousSlug = process.env.SOKOSUMI_ORGANIZATION_SLUG;
  process.env.SOKOSUMI_ORGANIZATION_SLUG = "developer-team";
  try {
    let headers: Headers | undefined;
    const options = {
      apiKey: "coworker_runtime-key",
      organizationSlug: "developer-team",
      fetchImpl: async (_input: string | URL | Request, init?: RequestInit) => {
        headers = new Headers(init?.headers);
        return new Response("{}");
      },
    };
    const client = createCoworkerHttpClient(options);
    await client.post("/v1/tasks/task-1/events", { comment: "Done" });
    assert.equal(headers?.has("x-organization-slug"), false);
    assert.equal(headers?.get("authorization"), "Bearer coworker_runtime-key");
  } finally {
    if (previousSlug === undefined)
      delete process.env.SOKOSUMI_ORGANIZATION_SLUG;
    else process.env.SOKOSUMI_ORGANIZATION_SLUG = previousSlug;
  }
});

// V81, V84: runtime calls use only the Coworker credential, directly over HTTP.
test("Coworker client uses its key on Preprod without developer auth", async (context) => {
  const developerAuth = context.mock.method(
    AuthManager.prototype,
    "getAuthTokenAsync",
    async () => {
      throw new Error("Developer authentication must not run");
    },
  );
  const previousToken = process.env.SOKOSUMI_AUTH_TOKEN;
  const previousApiKey = process.env.SOKOSUMI_API_KEY;
  const previousApiUrl = process.env.SOKOSUMI_API_URL;
  process.env.SOKOSUMI_AUTH_TOKEN = "developer-oauth-token";
  process.env.SOKOSUMI_API_KEY = "soko_mainnet_developer";
  process.env.SOKOSUMI_API_URL = "https://api.sokosumi.com";
  const requests: { url: string; init?: RequestInit }[] = [];
  try {
    const client = createCoworkerHttpClient({
      apiKey: "coworker_runtime-key",
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return new Response(JSON.stringify({ data: { id: "cw-1" } }));
      },
    });
    const controller = new AbortController();
    assert.deepEqual(await client.get("/v1/coworkers/me"), {
      data: { id: "cw-1" },
    });
    await client.post(
      "/v1/tasks/task-1/events",
      { comment: "Task result" },
      controller.signal,
    );
    assert.equal(requests.length, 2);
    assert.equal(
      requests[0]?.url,
      "https://api.preprod.sokosumi.com/v1/coworkers/me",
    );
    assert.equal(
      requests[1]?.url,
      "https://api.preprod.sokosumi.com/v1/tasks/task-1/events",
    );
    for (const { init } of requests) {
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer coworker_runtime-key",
      );
      assert.equal(init?.redirect, "error");
    }
    assert.equal(requests[1]?.init?.method, "POST");
    assert.equal(requests[1]?.init?.body, '{"comment":"Task result"}');
    assert.equal(requests[1]?.init?.signal, controller.signal);
    assert.equal(developerAuth.mock.callCount(), 0);
  } finally {
    for (const [name, previous] of [
      ["SOKOSUMI_AUTH_TOKEN", previousToken],
      ["SOKOSUMI_API_KEY", previousApiKey],
      ["SOKOSUMI_API_URL", previousApiUrl],
    ] as const) {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    }
  }
});

// V81: a runtime cannot fall back to OAuth or a user API key.
test("Coworker client rejects missing and developer credentials before HTTP", () => {
  let requests = 0;
  for (const apiKey of [
    "",
    "coworker_",
    "soko_preprod_developer",
    "soko_mainnet_developer",
    "developer-oauth-token",
    " coworker_runtime-key",
    "coworker_runtime-key\n",
    "coworker_runtime key",
  ]) {
    assert.throws(
      () =>
        createCoworkerHttpClient({
          apiKey,
          fetchImpl: async () => {
            requests++;
            return new Response("{}");
          },
        }),
      /requires a nonempty coworker_\* API key without whitespace/,
    );
  }
  assert.equal(requests, 0);
});

// V81, V90: runtime credentials stay on the pinned Preprod Core target.
test("Coworker client rejects absolute and escaping paths before HTTP", async () => {
  let requests = 0;
  const client = createCoworkerHttpClient({
    apiKey: "coworker_runtime-key",
    fetchImpl: async () => {
      requests++;
      return new Response("{}");
    },
  });
  for (const pathname of [
    "https://api.sokosumi.com/v1/tasks",
    "//example.test/v1/tasks",
    "/v1/../auth",
    "/v1/tasks/../../auth",
    "/v1/./tasks",
    "/v1/%2e%2e/auth",
    "/v1/tasks/%2E%2E/events",
    "/v1/tasks/%252e%252e/events",
    "/v1/tasks/%2f..%2fauth",
    "/v1/tasks/%5c..%5cauth",
    "/v1/tasks\\..\\auth",
    "/v1/tasks#fragment",
    "/v1/tasks\n",
    "/v1/tasks/%invalid",
  ]) {
    await assert.rejects(client.get(pathname), /require a \/v1\/ Core path/);
  }
  assert.equal(requests, 0);
});

test("Coworker client preserves query parameters and escaped IDs", async () => {
  let url = "";
  const client = createCoworkerHttpClient({
    apiKey: "coworker_runtime-key",
    fetchImpl: async (input) => {
      url = String(input);
      return new Response("{}");
    },
  });
  await client.get("/v1/tasks/task%3A1?status=READY&take=1");
  assert.equal(
    url,
    "https://api.preprod.sokosumi.com/v1/tasks/task%3A1?status=READY&take=1",
  );
});

// V78: never expose the runtime bearer through errors or redirect destinations.
test("Coworker client rejects redirect responses", async () => {
  for (const status of [301, 302, 307, 308]) {
    let requests = 0;
    const client = createCoworkerHttpClient({
      apiKey: "coworker_runtime-key",
      fetchImpl: async (_input, init) => {
        requests++;
        assert.equal(init?.redirect, "error");
        return new Response(null, {
          status,
          headers: { location: "https://example.test/coworker_runtime-key" },
        });
      },
    });
    await assert.rejects(client.get("/v1/coworkers/me"), /must not redirect/);
    assert.equal(requests, 1);
  }
});

test("Coworker client rejects an already followed redirect", async () => {
  const response = new Response("{}");
  Object.defineProperty(response, "redirected", { value: true });
  const client = createCoworkerHttpClient({
    apiKey: "coworker_runtime-key",
    fetchImpl: async () => response,
  });
  await assert.rejects(client.get("/v1/coworkers/me"), /must not redirect/);
});

test("Coworker client redacts failures while reading the response body", async (context) => {
  const apiKey = "coworker_runtime-secret";
  const response = new Response("{}");
  context.mock.method(response, "text", async () => {
    throw new Error(`Body interrupted for ${apiKey}`);
  });
  const client = createCoworkerHttpClient({
    apiKey,
    fetchImpl: async () => response,
  });
  await assert.rejects(client.get("/v1/coworkers/me"), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.doesNotMatch(error.message, /coworker_runtime-secret/);
    assert.doesNotMatch(JSON.stringify(error), /coworker_runtime-secret/);
    assert.match(error.message, /Body interrupted for \[REDACTED\]/);
    return true;
  });
});

test("Coworker client redacts response and fetch errors without retrying", async () => {
  const apiKey = "coworker_runtime-secret";
  for (const failure of ["response", "fetch"] as const) {
    let requests = 0;
    const client = createCoworkerHttpClient({
      apiKey,
      fetchImpl: async () => {
        requests++;
        if (failure === "fetch") {
          throw new Error(`Connection failed for ${apiKey}`);
        }
        return new Response(
          JSON.stringify({ message: `Denied ${apiKey}`, token: apiKey }),
          { status: 401 },
        );
      },
    });
    await assert.rejects(client.get("/v1/coworkers/me"), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /coworker_runtime-secret/);
      assert.doesNotMatch(JSON.stringify(error), /coworker_runtime-secret/);
      assert.match(error.message, /\[REDACTED\]/);
      if (failure === "response") {
        assert.equal("status" in error && error.status, 401);
      }
      return true;
    });
    assert.equal(requests, 1);
  }
});
