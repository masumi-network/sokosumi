import assert from "node:assert/strict";
import test from "node:test";

import {
  type CoreHttpClient,
  createApiError,
} from "../../src/api/http-client.js";
import { resolveCliConfig } from "../../src/auth/config.js";
import { runAuthWhoami } from "../../src/cli/auth-whoami.js";

const config = resolveCliConfig({ env: {}, preprod: true });
const identity = {
  id: "user-1",
  email: "developer@example.com",
  role: "user",
};

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>(path: string, signal?: AbortSignal) => {
      assert.equal(path, "/v1/users/me");
      assert.ok(signal);
      return response as T;
    },
    post: async () => {
      throw new Error("Identity lookup must not write");
    },
    patch: async () => {
      throw new Error("Identity lookup must not write");
    },
  };
}

test("auth whoami emits one allowlisted identity document", async () => {
  const output: string[] = [];
  const result = await runAuthWhoami({
    client: clientWith({
      data: {
        ...identity,
        name: "Private Name",
        token: "response-token-secret",
        metadata: { apiKey: "nested-key-secret" },
      },
      meta: { accessToken: "meta-token-secret" },
    }),
    config,
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  assert.deepEqual(result, {
    user: {
      id: identity.id,
      email: identity.email,
      platformRole: "user",
    },
    target: "preprod",
    apiUrl: "https://api.preprod.sokosumi.com",
  });
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]), result);
  assert.doesNotMatch(output[0], /secret|Private Name|metadata|meta/);
});

test("auth whoami labels platform authority separately from Vendor roles", async () => {
  const output: string[] = [];
  await runAuthWhoami({
    client: clientWith({ data: { ...identity, role: "admin" } }),
    config,
    stdout: { write: (value) => output.push(value) },
  });

  assert.equal(
    output.join(""),
    "Signed in as: developer@example.com\nUser ID: user-1\nPlatform role: admin\nTarget: preprod\nAPI URL: https://api.preprod.sokosumi.com\n",
  );
});

test("auth whoami sanitizes the selected API URL", async () => {
  const output: string[] = [];
  const result = await runAuthWhoami({
    client: clientWith({ data: identity }),
    config: {
      ...config,
      target: "custom",
      apiUrl:
        "https://user:password@example.test/core?api_key=key-secret&region=west#fragment",
    },
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  assert.equal(result.apiUrl, "https://example.test/core?region=west");
  assert.doesNotMatch(output[0], /password|key-secret|fragment/);
});

test("auth whoami rejects malformed profiles without a success document", async () => {
  for (const data of [
    null,
    [],
    {},
    { ...identity, id: " " },
    { ...identity, email: null },
    { ...identity, email: "developer@example.com\nPlatform role: admin" },
    { ...identity, role: 123 },
    { ...identity, role: "" },
  ]) {
    const output: string[] = [];
    await assert.rejects(
      runAuthWhoami({
        client: clientWith({ data }),
        config,
        stdout: { write: (value) => output.push(value) },
        json: true,
      }),
      /Invalid user identity response/,
    );
    assert.deepEqual(output, []);
  }
});

test("auth whoami preserves bounded API status without response secrets", async () => {
  for (const status of [401, 403, 500]) {
    const client = clientWith(undefined);
    client.get = async () => {
      throw createApiError(status, {
        message: "opaque-response-secret",
        token: "nested-token-secret",
      });
    };
    const output: string[] = [];
    await assert.rejects(
      runAuthWhoami({
        client,
        config,
        stdout: { write: (value) => output.push(value) },
        json: true,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, new RegExp(`Core API status ${status}`));
        assert.doesNotMatch(error.message, /secret/);
        assert.equal("status" in error && error.status, status);
        if (status === 401) assert.match(error.message, /Sign in again/);
        return true;
      },
    );
    assert.deepEqual(output, []);
  }
});

test("auth whoami does not expose raw transport failures", async () => {
  const client = clientWith(undefined);
  client.get = async () => {
    throw new Error("Request failed for opaque-oauth-secret");
  };
  await assert.rejects(
    runAuthWhoami({ client, config, stdout: { write: () => undefined } }),
    { message: "Could not verify the signed-in account." },
  );
});

test("auth whoami passes caller cancellation to its bounded request", async () => {
  const controller = new AbortController();
  controller.abort();
  const client = clientWith(undefined);
  client.get = async <T>(_path: string, signal?: AbortSignal) => {
    assert.ok(signal?.aborted);
    signal.throwIfAborted();
    return undefined as T;
  };
  await assert.rejects(
    runAuthWhoami({
      client,
      config,
      stdout: { write: () => undefined },
      signal: controller.signal,
    }),
    {
      message:
        "Could not verify the signed-in account: request canceled or timed out.",
    },
  );
});
