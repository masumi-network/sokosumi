import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import type { CoreHttpClient } from "../../src/api/http-client.js";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { runGenericCommand } from "../../src/cli/commands/generic.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

interface Call {
  method: string;
  url: string;
  slug: string | null;
  body: unknown;
}

function fixture(t: TestContext, response: unknown = { data: [] }) {
  const output: string[] = [];
  const calls: Call[] = [];
  const deps: CliDependencies = {
    env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
  };
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("Authorization"), "Bearer fixture-token");
      calls.push({
        method: init?.method ?? "GET",
        url: String(input),
        slug: headers.get("X-Organization-Slug"),
        body:
          init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      return Response.json(response);
    },
  );
  return { deps, output, calls };
}

const API = ["--api-url", "https://fixture.invalid"];

for (const [command, resource] of [
  ["events", "events"],
  ["files", "files"],
  ["links", "links"],
] as const) {
  test(`jobs ${command} prints Core's JSON for GET /jobs/{id}/${resource}`, async (t) => {
    const body = { data: [{ id: `${resource}-1` }] };
    const f = fixture(t, body);
    await runCli([...API, "jobs", command, "job 1"], f.deps);
    assert.deepEqual(f.calls, [
      {
        method: "GET",
        url: `https://fixture.invalid/v1/jobs/job%201/${resource}`,
        slug: null,
        body: undefined,
      },
    ]);
    assert.deepEqual(JSON.parse(f.output.join("")), body);
  });
}

test("a generic command sends --query pairs and the selected Workspace", async (t) => {
  const f = fixture(t);
  await runCli(
    [
      ...API,
      "jobs",
      "events",
      "job-1",
      "--query",
      "limit=5",
      "--query=cursor=a=b",
      "--organization-slug",
      "utxo",
      "--json",
    ],
    f.deps,
  );
  assert.equal(
    f.calls[0]?.url,
    "https://fixture.invalid/v1/jobs/job-1/events?limit=5&cursor=a%3Db",
  );
  assert.equal(f.calls[0]?.slug, "utxo");
});

test("a generic write sends --input-json or --input-file as the body", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return { data: { id: "x-1" } } as T;
    },
  } as unknown as CoreHttpClient;
  const output: string[] = [];
  const row = {
    command: "things move",
    usage: "ID",
    operation: "POST /things/{id}/move",
  } as const;
  const dir = await mkdtemp(join(tmpdir(), "sokosumi-generic-"));
  const file = join(dir, "input.json");
  await writeFile(file, '{"to":"b"}');
  const run = (options: Record<string, string>) =>
    runGenericCommand({
      client,
      stdout: { write: (value) => output.push(value) },
      row,
      args: ["x-1"],
      options,
    });
  await run({ "input-json": '{"to":"a"}' });
  await run({ "input-file": file });
  await assert.rejects(
    run({}),
    /`things move` needs --input-json or --input-file/,
  );
  assert.deepEqual(calls, [
    { path: "/v1/things/x-1/move", body: { to: "a" } },
    { path: "/v1/things/x-1/move", body: { to: "b" } },
  ]);
  assert.deepEqual(JSON.parse(output[0]!), { data: { id: "x-1" } });
});

test("a generic DELETE sends a body only when its row takes one", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    delete: async <T>(path: string, body?: unknown) => {
      calls.push({ path, body });
      return undefined as T;
    },
  } as unknown as CoreHttpClient;
  const run = (body: boolean, options: Record<string, string>) =>
    runGenericCommand({
      client,
      stdout: { write() {} },
      row: {
        command: "things delete",
        usage: "",
        operation: "DELETE /things/delete",
        ...(body ? { body: true as const } : {}),
      },
      args: [],
      options,
    });
  await run(true, { "input-json": '{"pathname":"a.pdf"}' });
  await run(false, {});
  await assert.rejects(
    run(true, {}),
    /`things delete` needs --input-json or --input-file/,
  );
  await assert.rejects(
    run(false, { "input-json": "{}" }),
    /`things delete` takes no --input-json or --input-file/,
  );
  assert.deepEqual(calls, [
    { path: "/v1/things/delete", body: { pathname: "a.pdf" } },
    { path: "/v1/things/delete", body: undefined },
  ]);
});

test("a generic Task command resolves a short identifier to the Task id", async (t) => {
  const id = "01a20919-70ff-7529-9bd5-78b72b6a3ea2";
  const f = fixture(t, { data: { id, identifier: "SOK-12" } });
  await runCli([...API, "tasks", "files", "SOK-12"], f.deps);
  await runCli([...API, "tasks", "files", id], f.deps);
  assert.deepEqual(
    f.calls.map((call) => `${call.method} ${call.url}`),
    [
      "GET https://fixture.invalid/v1/tasks/SOK-12",
      `GET https://fixture.invalid/v1/tasks/${id}/files`,
      `GET https://fixture.invalid/v1/tasks/${id}/files`,
    ],
  );
});

test("a generic write whose row has noBody sends no body and refuses one", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = {
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return { data: { id: "x-1" } } as T;
    },
  } as unknown as CoreHttpClient;
  const run = (options: Record<string, string>) =>
    runGenericCommand({
      client,
      stdout: { write() {} },
      row: {
        command: "things pause",
        usage: "ID",
        operation: "POST /things/{id}/pause",
        noBody: true,
      },
      args: ["x-1"],
      options,
    });
  await run({});
  await assert.rejects(
    run({ "input-json": "{}" }),
    /`things pause` takes no --input-json or --input-file/,
  );
  assert.deepEqual(calls, [{ path: "/v1/things/x-1/pause", body: undefined }]);
});

test("a write whose operation takes no body sends none and needs no input", async (t) => {
  const f = fixture(t, { data: { id: "n-1", isRead: true } });
  await runCli([...API, "notifications", "read", "n-1", "--json"], f.deps);
  await runCli([...API, "notifications", "read-all", "--json"], f.deps);
  assert.deepEqual(f.calls, [
    {
      method: "PATCH",
      url: "https://fixture.invalid/v1/notifications/n-1/read",
      slug: null,
      body: undefined,
    },
    {
      method: "PATCH",
      url: "https://fixture.invalid/v1/notifications/read-all",
      slug: null,
      body: undefined,
    },
  ]);
});

for (const [name, argv, message] of [
  [
    "input on a write that takes no body",
    ["notifications", "read", "n-1", "--input-json", "{}"],
    /`notifications read` takes no --input-json or --input-file/,
  ],
  [
    "an option a body-less write does not use",
    ["notifications", "unread", "n-1", "--limit", "5"],
    /`notifications unread` does not take --limit/,
  ],
  [
    "a write with a body but no input",
    ["jobs", "update", "job-1"],
    /`jobs update` needs --input-json or --input-file/,
  ],
  [
    "a missing path parameter",
    ["jobs", "events"],
    /Usage: sokosumi jobs events JOB_ID/,
  ],
  [
    "an extra argument",
    ["jobs", "events", "job-1", "job-2"],
    /Unexpected argument: job-2/,
  ],
  [
    "a dot-dot segment",
    ["jobs", "events", ".."],
    /Usage: sokosumi jobs events JOB_ID/,
  ],
  [
    "a dot segment",
    ["jobs", "events", "."],
    /Usage: sokosumi jobs events JOB_ID/,
  ],
  [
    "an option it does not use",
    ["jobs", "events", "job-1", "--limit", "5"],
    /`jobs events` does not take --limit/,
  ],
  [
    "--api-key-stdin",
    ["jobs", "events", "job-1", "--api-key-stdin"],
    /`jobs events` does not take --api-key-stdin/,
  ],
  [
    "a --query without =",
    ["jobs", "events", "job-1", "--query", "limit"],
    /--query expects KEY=VALUE/,
  ],
  [
    "input on a read",
    ["jobs", "events", "job-1", "--input-json", "{}"],
    /`jobs events` takes no --input-json or --input-file/,
  ],
] as const) {
  test(`a generic command rejects ${name} before calling Core`, async (t) => {
    const f = fixture(t);
    await assert.rejects(runCli([...API, ...argv, "--json"], f.deps), message);
    assert.equal(f.calls.length, 0);
    assert.match(JSON.parse(f.output.join("")).error, message);
  });
}

test("a generic command encodes a path value so it stays one segment", async (t) => {
  const f = fixture(t);
  await runCli([...API, "jobs", "events", "a/b?x#y"], f.deps);
  assert.equal(
    f.calls[0]?.url,
    "https://fixture.invalid/v1/jobs/a%2Fb%3Fx%23y/events",
  );
});

test("jobs commands send the selected Workspace", async (t) => {
  const f = fixture(t, { data: { id: "job-1", status: "COMPLETED" } });
  await runCli(
    [...API, "jobs", "get", "job-1", "--organization-slug", "utxo", "--json"],
    f.deps,
  );
  assert.deepEqual(
    f.calls.map(({ url, slug }) => ({ url, slug })),
    [{ url: "https://fixture.invalid/v1/jobs/job-1", slug: "utxo" }],
  );
});

for (const [argv, message] of [
  [
    ["tasks", "list", "--query", "status=READY"],
    /--query is only supported by the commands that call one Core operation \(see sokosumi --help\)/,
  ],
  [
    ["skills", "--query", "a=b"],
    /--query is only supported by the commands that call one Core operation/,
  ],
  [
    ["runtime", "receipt", "task-1", "--query", "a=b"],
    /--query is only supported by the commands that call one Core operation/,
  ],
  [
    ["agents", "list", "--organization-slug", "utxo"],
    /--organization-slug is only supported by tasks and jobs commands/,
  ],
] as const) {
  test(`${argv.slice(0, 2).join(" ")} rejects ${argv.at(-2)} before calling Core`, async (t) => {
    const f = fixture(t);
    await assert.rejects(runCli([...API, ...argv], f.deps), message);
    assert.equal(f.calls.length, 0);
  });
}
