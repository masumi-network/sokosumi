import assert from "node:assert/strict";
import test from "node:test";
import {
  type CoreHttpClient,
  createApiError,
} from "../../src/api/http-client.js";
import { runCoworkersCommand } from "../../src/cli/commands/coworkers.js";

function fixture(vendorRole = "admin", status = "PENDING") {
  const reads: string[] = [];
  const writes: string[] = [];
  const output: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      reads.push(path);
      if (path === "/v1/users/me")
        return {
          data: {
            id: "participant",
            email: "participant@example.com",
            role: "user",
          },
        } as T;
      if (path === "/v1/vendors/me")
        return { data: [{ id: "own-vendor", role: vendorRole }] } as T;
      if (path === "/v1/users/me/organizations")
        return {
          data: [{ id: "event-org", name: "Event", role: "member" }],
        } as T;
      if (path === "/v1/coworkers/own-coworker")
        return {
          data: { id: "own-coworker", vendor: { id: "own-vendor" } },
        } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    post: async <T>(path: string) => {
      writes.push(path);
      if (path === "/v1/coworkers")
        return {
          data: {
            id: "own-coworker",
            name: "Agent",
            vendor: { id: "own-vendor" },
            isWhitelisted: false,
          },
        } as T;
      if (path.endsWith("/workspace-access") && status === "TERMINAL")
        throw createApiError(400, {
          error: "Bad Request",
          message: "Cannot re-request after deny/revoke",
        });
      if (path.endsWith("/workspace-access"))
        return {
          data: {
            id: "request-1",
            coworkerId: "own-coworker",
            workspaceId: "event-workspace",
            status,
          },
        } as T;
      if (path.endsWith("/api-keys"))
        return {
          data: {
            id: "key-1",
            token: "coworker_fixture_secret",
            name: null,
            expiresAt: null,
          },
        } as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    patch: async () => {
      throw new Error("Unexpected PATCH");
    },
    put: async () => {
      throw new Error("Unexpected PUT");
    },
  };
  return {
    client,
    reads,
    writes,
    output,
    stdout: {
      write(value: string) {
        output.push(value);
      },
    },
  };
}

// V91, V98: own Vendor admin can provision privately without organization discovery.
test("ordinary Vendor admin provisions a private Coworker without a Workspace", async () => {
  const f = fixture();
  await runCoworkersCommand({
    ...f,
    target: "preprod",
    subcommand: "provision",
    json: true,
    options: { "vendor-id": "own-vendor", name: "Agent", capability: "tasks" },
  });
  assert.deepEqual(f.reads, ["/v1/users/me", "/v1/vendors/me"]);
  assert.deepEqual(f.writes, ["/v1/coworkers"]);
  const result = JSON.parse(f.output.join(""));
  assert.equal(result.coworker.isWhitelisted, false);
  assert.deepEqual(result.handoff, {
    coworkerId: "own-coworker",
    vendorId: "own-vendor",
  });
  assert.equal(result.apiKey, undefined);
});

test("Vendor developer cannot provision a Coworker", async () => {
  const f = fixture("developer");
  await assert.rejects(
    runCoworkersCommand({
      ...f,
      target: "preprod",
      subcommand: "provision",
      options: { "vendor-id": "own-vendor", name: "Agent" },
    }),
    /registration requires admin/,
  );
  assert.equal(f.writes.length, 0);
});

// V92: PENDING is an approval request, never a granted Workspace or a create retry.
for (const command of ["register", "connect"] as const) {
  for (const json of [false, true]) {
    test(`${command} returns PENDING access identifiers in ${json ? "JSON" : "text"}`, async () => {
      const f = fixture();
      await runCoworkersCommand({
        ...f,
        target: "preprod",
        subcommand: command,
        json,
        positionalId: command === "connect" ? "own-coworker" : undefined,
        options: {
          "vendor-id": "own-vendor",
          "workspace-id": "event-org",
          name: "Agent",
        },
      });
      assert.deepEqual(
        f.writes,
        command === "register"
          ? ["/v1/coworkers", "/v1/coworkers/own-coworker/workspace-access"]
          : ["/v1/coworkers/own-coworker/workspace-access"],
      );
      if (json) {
        const result = JSON.parse(f.output.join(""));
        assert.equal(result.workspaceAccess.status, "PENDING");
        assert.equal(result.workspaceAccess.id, "request-1");
        assert.equal(result.workspaceAccess.coworkerId, "own-coworker");
      } else {
        assert.match(
          f.output.join(""),
          /approval requested.*own-coworker.*request-1/,
        );
        assert.match(f.output.join(""), /Do not register again/);
        assert.match(
          f.output.join(""),
          /Wait for a Workspace owner or admin.*coworkers connect own-coworker/,
        );
        assert.doesNotMatch(
          f.output.join(""),
          /Connected coworker|Registered coworker/,
        );
      }
      assert.doesNotMatch(f.output.join(""), /coworker_fixture_secret/);
    });
  }
}

test("explicit key creation works while organization access awaits approval", async () => {
  const f = fixture();
  await runCoworkersCommand({
    ...f,
    target: "preprod",
    subcommand: "register",
    json: true,
    options: {
      "vendor-id": "own-vendor",
      "workspace-id": "event-org",
      name: "Agent",
      "create-api-key": true,
    },
  });
  assert.deepEqual(f.writes, [
    "/v1/coworkers",
    "/v1/coworkers/own-coworker/workspace-access",
    "/v1/coworkers/own-coworker/api-keys",
  ]);
  const result = JSON.parse(f.output.join(""));
  assert.equal(result.workspaceAccess.status, "PENDING");
  assert.equal(result.apiKey.token, "coworker_fixture_secret");
});

test("connect gives recovery text when Core refuses a denied or revoked request", async () => {
  const f = fixture("admin", "TERMINAL");
  await assert.rejects(
    runCoworkersCommand({
      ...f,
      target: "preprod",
      subcommand: "connect",
      json: true,
      positionalId: "own-coworker",
      options: { "vendor-id": "own-vendor", "workspace-id": "event-org" },
    }),
    /Coworker own-coworker Workspace access was denied or revoked\. Keep this Coworker ID\. Ask a Workspace owner or admin to restore access\. Do not register again\./,
  );
  assert.equal(f.output.length, 0);
});

test("connect does not report an unknown status as approval requested", async () => {
  const f = fixture("admin", "UNKNOWN");
  await assert.rejects(
    runCoworkersCommand({
      ...f,
      target: "preprod",
      subcommand: "connect",
      json: true,
      positionalId: "own-coworker",
      options: { "vendor-id": "own-vendor", "workspace-id": "event-org" },
    }),
    /access is UNKNOWN/,
  );
  assert.equal(f.output.length, 0);
});
