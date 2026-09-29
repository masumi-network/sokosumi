import assert from "node:assert/strict";
import test from "node:test";
import { createCoreHttpClient } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { runCoworkersCommand } from "../../src/cli/commands/coworkers.js";

function creationAttempt(
  command: "provision" | "register",
  respond: () => Response,
  name: string | null = "Agent",
) {
  const posts: string[] = [];
  const output: string[] = [];
  const client = createCoreHttpClient({
    apiUrl: "https://api.preprod.sokosumi.com",
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    environment: { SOKOSUMI_AUTH_TOKEN: "fixture-user-token" },
    fetchImpl: async (url, init) => {
      const path = new URL(String(url)).pathname;
      if (init?.method === "POST") {
        posts.push(path);
        return respond();
      }
      assert.equal(init?.method, "GET");
      if (path === "/v1/users/me")
        return Response.json({
          data: { id: "admin-1", email: "admin@example.com", role: "admin" },
        });
      if (path === "/v1/users/me/organizations")
        return Response.json({ data: [{ id: "org-1" }] });
      assert.equal(path, "/v1/vendors/me");
      return Response.json({ data: [{ id: "vendor-1", role: "admin" }] });
    },
  });
  return {
    posts,
    output,
    run: () =>
      runCoworkersCommand({
        client,
        stdout: { write: (value) => output.push(value) },
        json: true,
        target: "preprod",
        subcommand: command,
        options: {
          "vendor-id": "vendor-1",
          ...(name === null ? {} : { name }),
          ...(command === "register" ? { "workspace-id": "org-1" } : {}),
        },
      }),
  };
}

// SPEC V18, V92, V98: real HTTP boundary, recoverable registration, Core authority.
for (const command of ["provision", "register"] as const) {
  test(`${command} rejects missing and blank names without uncertain-write advice`, async () => {
    for (const name of [null, " "]) {
      const attempt = creationAttempt(
        command,
        () => {
          throw new Error("Unexpected creation");
        },
        name,
      );
      await assert.rejects(attempt.run(), { message: "name is required" });
      assert.deepEqual(attempt.posts, []);
      assert.deepEqual(attempt.output, []);
    }
  });

  for (const outcome of [
    "transport",
    "invalid-json",
    "server-error",
  ] as const) {
    test(`${command} requires inspection after an uncertain creation (${outcome})`, async () => {
      const transportError = new TypeError(
        "fetch failed after sending request",
      );
      const body = {
        error: "Internal Server Error",
        message: "upstream failed after creation",
        meta: { requestId: "creation-request" },
      };
      const attempt = creationAttempt(command, () => {
        if (outcome === "transport") throw transportError;
        if (outcome === "invalid-json")
          return new Response("<html>interrupted response</html>", {
            status: 201,
          });
        return Response.json(body, { status: 500 });
      });
      await assert.rejects(attempt.run(), (error: unknown) => {
        assert.ok(error instanceof Error);
        if (outcome === "transport") assert.equal(error, transportError);
        if (outcome === "invalid-json")
          assert.match(
            error.message,
            /Core API returned invalid JSON \(status 201\)/,
          );
        if (outcome === "server-error") {
          assert.equal(error.name, "CoreApiError");
          assert.equal("status" in error && error.status, 500);
          assert.deepEqual("body" in error && error.body, body);
          assert.match(error.message, /upstream failed after creation/);
          assert.match(error.message, /creation-request/);
        }
        assert.match(error.message, /Creation may have succeeded/);
        assert.match(
          error.message,
          /Inspect `sokosumi --preprod coworkers list --scope all` before retrying/,
        );
        return true;
      });
      assert.deepEqual(attempt.posts, ["/v1/coworkers"]);
      assert.deepEqual(attempt.output, []);
    });
  }

  for (const status of [400, 401, 403, 409, 422]) {
    test(`${command} retains definitive Core ${status} without uncertain-write advice`, async () => {
      const body = {
        message: status === 403 ? "Admin access required" : "Creation rejected",
        meta: { requestId: "rejected-request" },
      };
      const attempt = creationAttempt(command, () =>
        Response.json(body, { status }),
      );
      await assert.rejects(attempt.run(), (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "CoreApiError");
        assert.equal("status" in error && error.status, status);
        assert.deepEqual("body" in error && error.body, body);
        assert.match(error.message, new RegExp(body.message));
        assert.match(error.message, /rejected-request/);
        assert.doesNotMatch(
          error.message,
          /may have succeeded|before retrying/i,
        );
        if (status === 403) {
          assert.match(error.message, /platform admin/);
          assert.match(error.message, /coworkers connect COWORKER_ID/);
        }
        return true;
      });
      assert.deepEqual(attempt.posts, ["/v1/coworkers"]);
      assert.deepEqual(attempt.output, []);
    });
  }
}
