import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  createCoworker,
  createCoworkerApiKey,
  fetchCoworkers,
  fetchCurrentCoworker,
  updateCoworker,
} from "../../src/api/services/coworker-service.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}
function client(
  calls: Call[],
  response: unknown = { data: [] },
): CoreHttpClient {
  return {
    get: async <T>(path: string) => {
      calls.push({ method: "GET", path });
      return response as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
    patch: async <T>(path: string, body: unknown) => {
      calls.push({ method: "PATCH", path, body });
      return response as T;
    },
  };
}

test("coworker services use Core routes, encode IDs, and repeat capabilities", async () => {
  const calls: Call[] = [];
  const api = client(calls, { data: [{ id: "cow-1" }] });
  await fetchCoworkers(api, {
    scope: "owned",
    capabilities: ["tasks", "chat"],
  });
  await fetchCurrentCoworker(api);
  await createCoworker(api, { name: "  Ops  ", vendorId: "vendor-1" });
  await updateCoworker(api, "cow/1", { caption: "Ops" });
  await createCoworkerApiKey(api, "cow/1", { name: " Production " });
  assert.deepEqual(
    calls.map(({ method, path }) => ({ method, path })),
    [
      {
        method: "GET",
        path: "/v1/coworkers?scope=owned&capability=tasks&capability=chat",
      },
      { method: "GET", path: "/v1/coworkers/me" },
      { method: "POST", path: "/v1/coworkers" },
      { method: "PATCH", path: "/v1/coworkers/cow%2F1" },
      { method: "POST", path: "/v1/coworkers/cow%2F1/api-keys" },
    ],
  );
  assert.deepEqual(calls[2]?.body, { name: "Ops", vendorId: "vendor-1" });
  assert.deepEqual(calls[4]?.body, { name: "Production" });
});

test("coworker services validate required inputs before HTTP", async () => {
  const calls: Call[] = [];
  const api = client(calls);
  await assert.rejects(() => createCoworker(api, {}), /name is required/);
  await assert.rejects(() => updateCoworker(api, ""), /coworkerId is required/);
  await assert.rejects(
    () => createCoworkerApiKey(api, ""),
    /coworkerId is required/,
  );
  assert.equal(calls.length, 0);
});
