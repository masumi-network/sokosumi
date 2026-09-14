import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import { fetchCurrentUser } from "../../src/api/services/user-service.js";

test("fetchCurrentUser calls the current-user Core route and parses its entity", async () => {
  const calls: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      calls.push(path);
      return { data: { id: "user-1", email: "ada@example.com" } } as T;
    },
    post: async <T>() => undefined as T,
    patch: async <T>() => undefined as T,
    delete: async <T>() => undefined as T,
  };
  const result = await fetchCurrentUser(client);
  assert.deepEqual(calls, ["/v1/users/me"]);
  assert.equal(result.user.id, "user-1");
  assert.equal(result.user.email, "ada@example.com");
});
