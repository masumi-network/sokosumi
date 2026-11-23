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
  };
  const dir = await mkdtemp(join(tmpdir(), "sokosumi-generic-"));
  const file = join(dir, "input.json");
  await writeFile(file, '{"to":"b"}');
  for (const options of [
    { "input-json": '{"to":"a"}' },
    { "input-file": file },
    {},
  ])
    await runGenericCommand({
      client,
      stdout: { write: (value) => output.push(value) },
      row,
      args: ["x-1"],
      options,
    });
  assert.deepEqual(calls, [
    { path: "/v1/things/x-1/move", body: { to: "a" } },
    { path: "/v1/things/x-1/move", body: { to: "b" } },
    { path: "/v1/things/x-1/move", body: {} },
  ]);
  assert.deepEqual(JSON.parse(output[0]!), { data: { id: "x-1" } });
});

for (const [name, argv, message] of [
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
    "a dot segment",
    ["jobs", "events", ".."],
    /Usage: sokosumi jobs events JOB_ID/,
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
