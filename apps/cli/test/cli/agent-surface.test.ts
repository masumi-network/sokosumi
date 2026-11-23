import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";

import { AuthManager } from "../../src/auth/auth-manager.js";
import { CLI_COMMAND_CATALOG } from "../../src/cli/commands/catalog.js";
import { parseArgv, runCli } from "../../src/cli/index.js";
import {
  CLI_SURFACE_FIXTURES,
  type CliSurfaceFixture,
  core,
} from "./agent-surface.fixtures.js";

const MANIFEST_DIR = new URL("../../../core/agent-surface/", import.meta.url);

interface Manifest {
  readonly operations?: Record<string, { readonly cli?: unknown }>;
}

/** Every manifest row whose `cli` names a command: [file, operation, command]. */
const CLI_ROWS = readdirSync(MANIFEST_DIR)
  .filter((name) => name.endsWith(".json"))
  .flatMap((name) => {
    const manifest: Manifest = JSON.parse(
      readFileSync(new URL(name, MANIFEST_DIR), "utf8"),
    );
    return Object.entries(manifest.operations ?? {}).flatMap(([op, row]) =>
      typeof row.cli === "string" ? [[name, op, row.cli] as const] : [],
    );
  });

test("every CLI command in the agent-surface manifests is in the catalog", () => {
  const catalog = new Set<string>(
    CLI_COMMAND_CATALOG.map((entry) => entry.command),
  );
  assert.deepEqual(
    CLI_ROWS.filter(([, , cli]) => !catalog.has(cli)).map(
      ([name, op, cli]) => `apps/core/agent-surface/${name} "${op}": ${cli}`,
    ),
    [],
    "Each manifest cli value must be a CLI_COMMAND_CATALOG command (apps/cli/src/cli/commands/catalog.ts).",
  );
});

test("a catalog row with an operation is the command its manifest row names", () => {
  const mapped = new Map(CLI_ROWS.map(([, op, cli]) => [op, cli]));
  assert.deepEqual(
    CLI_COMMAND_CATALOG.flatMap((entry) =>
      "operation" in entry && mapped.get(entry.operation) !== entry.command
        ? [`${entry.command}: ${entry.operation}`]
        : [],
    ),
    [],
  );
});

/** `GET /jobs/{id}` matches the request `GET /jobs/job-1`. */
function matches(operation: string, request: string): boolean {
  const pattern = operation
    .split(/\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  return new RegExp(`^${pattern}$`).test(request);
}

/** Runs one fixture against mocked Core and returns the requests it made, as `METHOD /path`. */
async function run(
  t: test.TestContext,
  fixture: CliSurfaceFixture,
): Promise<string[] | Error> {
  const requests: string[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (input: string | URL | Request, init?: RequestInit) => {
      const request = `${init?.method ?? "GET"} ${new URL(String(input)).pathname.replace(/^\/v1/, "")}`;
      requests.push(request);
      return Response.json((fixture.response ?? core)(request));
    },
  );
  try {
    await runCli([...fixture.argv], {
      env: { SOKOSUMI_AUTH_TOKEN: "fixture-token" },
      authManager: new AuthManager({
        credentialStore: { read: () => null, write() {}, clear() {} },
        apiKeyStore: { read: () => null, write() {}, clear() {} },
      }),
      stdout: { write() {} },
      readStdin: () => fixture.stdin ?? "",
      evalsSleep: async () => {},
    });
  } catch (error) {
    return error instanceof Error ? error : new Error(String(error));
  } finally {
    t.mock.restoreAll();
  }
  return requests;
}

test("every manifest CLI row has a fixture that runs its command and hits its operation", async (t) => {
  const rows = new Map(CLI_ROWS.map(([name, op, cli]) => [op, { name, cli }]));
  assert.deepEqual(
    {
      missing: [...rows.keys()].filter((op) => !CLI_SURFACE_FIXTURES[op]),
      stale: Object.keys(CLI_SURFACE_FIXTURES).filter((op) => !rows.has(op)),
    },
    { missing: [], stale: [] },
    "Each manifest row with a cli command needs a fixture keyed by its operation in apps/cli/test/cli/agent-surface.fixtures.ts.",
  );

  const failures: string[] = [];
  for (const [op, { name, cli }] of rows) {
    const fixture = CLI_SURFACE_FIXTURES[op]!;
    const where = `apps/core/agent-surface/${name} "${op}"`;
    const command = parseArgv([...fixture.argv])
      .positionals.slice(0, 2)
      .join(" ");
    if (command !== cli) {
      failures.push(`${where}: fixture runs ${command}, not ${cli}`);
      continue;
    }
    const requests = await run(t, fixture);
    if (requests instanceof Error)
      failures.push(`${where}: ${cli} failed: ${requests.message}`);
    else if (!requests.some((request) => matches(op, request)))
      failures.push(`${where}: ${cli} sent ${JSON.stringify(requests)}`);
  }
  assert.deepEqual(failures, []);
});
