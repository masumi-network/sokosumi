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

test("redacts authorization values from status errors", async () => {
  const credential = "very-secret-token";
  const client = createCoreHttpClient({
    apiUrl: "https://api.example.test",
    authManager: createManager({ SOKOSUMI_AUTH_TOKEN: credential }),
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          message: credential,
          authorization: credential,
          reason: "denied",
        }),
        { status: 403 },
      ),
  });

  await assert.rejects(
    () => client.get("/v1/agents"),
    (error: Error & { status?: number }) => {
      assert.equal(error.status, 403);
      assert.match(error.message, /403/);
      assert.match(error.message, /denied/);
      assert.doesNotMatch(error.message, new RegExp(credential));
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

test("createApiError keeps status and redacts sensitive body keys", () => {
  const error = createApiError(401, {
    authorization: "token",
    message: "Unauthorized",
  }) as Error & { status?: number; body?: unknown };

  assert.equal(error.status, 401);
  assert.match(error.message, /Unauthorized/);
  assert.doesNotMatch(error.message, /token/);
  assert.deepEqual(error.body, {
    authorization: "[REDACTED]",
    message: "Unauthorized",
  });
});
