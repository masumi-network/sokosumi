import assert from "node:assert/strict";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runCoworkersCommand } from "../../../src/cli/commands/coworkers.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => response as T,
    patch: async <T>() => response as T,
  };
}

test("coworkers list emits JSON and applies search/limit", async () => {
  const output: string[] = [];
  await runCoworkersCommand({
    client: clientWith({
      data: [
        { id: "cw-1", name: "Research", capabilities: ["tasks"] },
        { id: "cw-2", name: "Writer", capabilities: ["chat"] },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { search: "research", limit: "1" },
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworkers.length, 1);
  assert.equal(parsed.coworkers[0].id, "cw-1");
  assert.equal(parsed.coworkers[0].name, "Research");
});

test("coworkers register creates and connects the coworker to the selected workspace", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/vendors/me")) {
        return { data: [{ id: "vendor-1", name: "Acme", role: "admin" }] } as T;
      }
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: {} } as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      if (path.endsWith("/workspace-access")) {
        return {
          data: {
            id: "access-1",
            coworkerId: "cw-1",
            workspaceId: "workspace-1",
            status: "GRANTED",
          },
        } as T;
      }
      return {
        data: { id: "cw-1", name: "Ops Agent", capabilities: ["tasks"] },
      } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];

  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "register",
    target: "preprod",
    options: {
      name: "Ops Agent",
      "vendor-id": "vendor-1",
      "workspace-id": "org-1",
      capability: "tasks",
    },
  });

  assert.deepEqual(calls, [
    {
      path: "/v1/coworkers",
      body: {
        vendorId: "vendor-1",
        name: "Ops Agent",
        capabilities: ["tasks"],
      },
    },
    {
      path: "/v1/coworkers/cw-1/workspace-access",
      body: { organizationId: "org-1" },
    },
  ]);
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworker.id, "cw-1");
  assert.equal(parsed.coworker.name, "Ops Agent");
  assert.deepEqual(parsed.coworker.capabilities, ["tasks"]);
  assert.equal(parsed.workspaceAccess.status, "GRANTED");
});

test("coworkers register rejects Mainnet before any Core request", async () => {
  let requestCount = 0;
  const client: CoreHttpClient = {
    get: async <T>() => {
      requestCount += 1;
      return { data: [] } as T;
    },
    post: async <T>() => {
      requestCount += 1;
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "mainnet",
        options: { name: "Ops Agent", "vendor-id": "vendor-1" },
      }),
    /Preprod only/,
  );
  assert.equal(requestCount, 0);
});

test("coworkers register requires a selected member Workspace", async () => {
  let createCalled = false;
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: [{ id: "vendor-1", role: "admin" }] } as T;
    },
    post: async <T>(path: string) => {
      if (path === "/v1/coworkers") createCalled = true;
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "vendor-id": "vendor-1",
          "workspace-id": "org-other",
        },
      }),
    /not in your organization memberships/,
  );
  assert.equal(createCalled, false);
});

test("pending workspace access reports the created Coworker and retry command", async () => {
  const calls: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: [{ id: "vendor-1", role: "admin" }] } as T;
    },
    post: async <T>(path: string) => {
      calls.push(path);
      if (path.endsWith("/workspace-access")) {
        return {
          data: {
            id: "access-1",
            coworkerId: "cw-1",
            workspaceId: "workspace-1",
            status: "PENDING",
          },
        } as T;
      }
      return { data: { id: "cw-1", name: "Ops Agent" } } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "vendor-id": "vendor-1",
          "workspace-id": "org-1",
          "create-api-key": true,
        },
      }),
    /Coworker cw-1 was created, but Workspace access is PENDING.*coworkers connect cw-1/,
  );
  assert.deepEqual(calls, [
    "/v1/coworkers",
    "/v1/coworkers/cw-1/workspace-access",
  ]);
});

test("coworkers connect grants access to an existing Coworker", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: [{ id: "vendor-1", role: "admin" }] } as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return {
        data: {
          id: "access-1",
          coworkerId: "cw-1",
          workspaceId: "workspace-1",
          status: "GRANTED",
        },
      } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];

  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "connect",
    positionalId: "cw-1",
    target: "preprod",
    options: { "vendor-id": "vendor-1", "workspace-id": "org-1" },
  });

  assert.deepEqual(calls, [
    {
      path: "/v1/coworkers/cw-1/workspace-access",
      body: { organizationId: "org-1" },
    },
  ]);
  assert.equal(JSON.parse(output.join("")).workspaceAccess.status, "GRANTED");
});

test("coworkers register rejects a missing vendor ID before Core request", async () => {
  let postCalled = false;
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      if (path.includes("/vendors/me")) {
        return { data: [{ id: "vendor-1", role: "admin" }] } as T;
      }
      return { data: {} } as T;
    },
    post: async <T>() => {
      postCalled = true;
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "workspace-id": "org-1",
        },
      }),
    /vendor id is required/,
  );
  assert.equal(postCalled, false);
});

test("coworkers register blocks when no organization workspace exists", async () => {
  let postCalled = false;
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) return { data: [] } as T;
      return { data: [{ id: "vendor-1", role: "admin" }] } as T;
    },
    post: async <T>() => {
      postCalled = true;
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "vendor-id": "vendor-1",
          "workspace-id": "org-1",
        },
      }),
    /organization workspace/,
  );
  assert.equal(postCalled, false);
});

test("coworkers register rejects non-admin Vendor before Core create", async () => {
  let postCalled = false;
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      if (path.includes("/vendors/me")) {
        return {
          data: [{ id: "vendor-1", name: "Acme", role: "developer" }],
        } as T;
      }
      return { data: {} } as T;
    },
    post: async <T>() => {
      postCalled = true;
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "vendor-id": "vendor-1",
          "workspace-id": "org-1",
        },
      }),
    /requires admin/,
  );
  assert.equal(postCalled, false);
});

test("coworkers register requires --vendor-id and does not create a Vendor", async () => {
  const posts: { path: string; body: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: [] } as T;
    },
    post: async <T>(path: string, body?: unknown) => {
      posts.push({ path, body });
      return { data: {} } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "register",
        target: "preprod",
        options: {
          name: "Ops Agent",
          "workspace-id": "org-1",
        },
      }),
    /vendor id is required/,
  );
  assert.equal(posts.length, 0);
});

test("coworkers api-key requires an id", async () => {
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "api-key",
      }),
    /coworker id is required/,
  );
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "api-key",
        options: { "coworker-id": "cw-1" },
      }),
    /coworker id is required/,
  );
});

test("coworkers update patches the coworker and returns it", async () => {
  let path = "";
  let body: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>(requestPath: string, requestBody: unknown) => {
      path = requestPath;
      body = requestBody;
      return { data: { id: "cw-1", name: "Renamed" } } as T;
    },
  };
  const output: string[] = [];
  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "update",
    positionalId: "cw-1",
    options: { name: "Renamed" },
  });
  assert.equal(path, "/v1/coworkers/cw-1");
  assert.deepEqual(body, { name: "Renamed" });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworker.id, "cw-1");
  assert.equal(parsed.coworker.name, "Renamed");
});

test("coworkers update requires an id and rejects a vendor id", async () => {
  const client = clientWith({ data: {} });
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "update",
        options: { name: "x" },
      }),
    /coworker id is required/,
  );
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "update",
        options: { "coworker-id": "cw-1", name: "x" },
      }),
    /coworker id is required/,
  );
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client,
        stdout: { write() {} },
        subcommand: "update",
        positionalId: "cw-1",
        options: { "vendor-id": "vendor-1" },
      }),
    /--vendor-id is only supported for/,
  );
});

test("coworkers me returns the current coworker", async () => {
  const output: string[] = [];
  await runCoworkersCommand({
    client: clientWith({ data: { id: "cw-1", name: "Me" } }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "me",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworker.id, "cw-1");
  assert.equal(parsed.coworker.name, "Me");
});

test("coworkers api-key mints a key and returns the full token", async () => {
  let path = "";
  let body: { name?: unknown } | undefined;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>(requestPath: string, requestBody: unknown) => {
      path = requestPath;
      body = requestBody as typeof body;
      return {
        data: { id: "key-1", name: "ci", token: "soko_secret_value" },
      } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "api-key",
    positionalId: "cw-1",
    options: { "api-key-name": "ci" },
  });
  assert.equal(path, "/v1/coworkers/cw-1/api-keys");
  assert.equal(body?.name, "ci");
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworkerId, "cw-1");
  assert.equal(parsed.apiKey.name, "ci");
  assert.equal(parsed.apiKey.token, "soko_secret_value");
});

test("coworkers update sends the mapped multi-field payload", async () => {
  let path = "";
  let body: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>(requestPath: string, requestBody: unknown) => {
      path = requestPath;
      body = requestBody;
      return { data: { id: "cw-1", name: "Ops" } } as T;
    },
  };
  await runCoworkersCommand({
    client,
    stdout: { write() {} },
    json: true,
    subcommand: "update",
    positionalId: "cw-1",
    options: {
      caption: "Ops",
      company: "Acme",
      url: "https://acme.test",
      "base-url": "https://x.test",
      description: "desc",
      priority: "5",
      capability: "tasks",
    },
  });
  assert.equal(path, "/v1/coworkers/cw-1");
  assert.deepEqual(body, {
    caption: "Ops",
    company: "Acme",
    url: "https://acme.test",
    baseURL: "https://x.test",
    description: "desc",
    priority: 5,
    capabilities: ["tasks"],
  });
});

test("coworkers update omits an empty name", async () => {
  let body: Record<string, unknown> | undefined;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>(_path: string, requestBody: unknown) => {
      body = requestBody as Record<string, unknown>;
      return { data: { id: "cw-1" } } as T;
    },
  };
  await runCoworkersCommand({
    client,
    stdout: { write() {} },
    json: true,
    subcommand: "update",
    positionalId: "cw-1",
    options: { name: "", description: "kept" },
  });
  assert.equal("name" in (body ?? {}), false);
  assert.equal(body?.description, "kept");
});

test("coworkers api-key text output masks the token", async () => {
  const output: string[] = [];
  await runCoworkersCommand({
    client: clientWith({
      data: { id: "key-1", name: "ci", token: "soko_secret_value" },
    }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "api-key",
    positionalId: "cw-1",
    options: { "api-key-name": "ci" },
  });
  const text = output.join("");
  assert.doesNotMatch(text, /soko_secret_value/);
  assert.match(text, /soko_sec\.\.alue/);
});

test("coworkers register --create-api-key mints and returns the key", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/vendors/me")) {
        return { data: [{ id: "vendor-1", name: "Acme", role: "admin" }] } as T;
      }
      if (path.includes("/organizations")) {
        return {
          data: [{ id: "org-1", name: "Acme Org", role: "owner" }],
        } as T;
      }
      return { data: {} } as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      if (path.endsWith("/api-keys"))
        return {
          data: { id: "key-1", name: "deploy", token: "soko_secret_value" },
        } as T;
      if (path.endsWith("/workspace-access")) {
        return {
          data: {
            id: "access-1",
            coworkerId: "cw-1",
            workspaceId: "workspace-1",
            status: "GRANTED",
          },
        } as T;
      }
      return {
        data: { id: "cw-1", name: "Ops", capabilities: ["tasks"] },
      } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "register",
    target: "preprod",
    options: {
      name: "Ops",
      "vendor-id": "vendor-1",
      "workspace-id": "org-1",
      "create-api-key": true,
      "api-key-name": "deploy",
    },
  });
  assert.equal(calls[0]?.path, "/v1/coworkers");
  assert.equal(calls[1]?.path, "/v1/coworkers/cw-1/workspace-access");
  assert.equal(calls[2]?.path, "/v1/coworkers/cw-1/api-keys");
  const keyBody = calls[2]?.body;
  if (!keyBody || typeof keyBody !== "object" || !("name" in keyBody))
    throw new Error("api-key request body missing name");
  assert.equal(keyBody.name, "deploy");
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworker.id, "cw-1");
  assert.equal(parsed.apiKey.token, "soko_secret_value");
});
