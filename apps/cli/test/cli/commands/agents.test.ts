import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import type { Agent } from "../../../src/api/models/agent.js";
import { runAgentsCommand } from "../../../src/cli/commands/agents.js";

function createAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    createdAt: null,
    updatedAt: null,
    name: "Researcher",
    description: "Finds facts",
    status: "ONLINE",
    isNew: false,
    isShown: true,
    price: { credits: 1, includedFee: 0 },
    tags: [{ name: "research" }],
    ...overrides,
  };
}

test("filters agents by searchable fields and applies a limit", async () => {
  const output: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>() =>
      ({
        data: [
          createAgent(),
          createAgent({
            id: "agent-2",
            name: "Writer",
            tags: [{ name: "copy" }],
          }),
        ],
      }) as T,
    post: async <T>() => ({ data: null }) as T,
    patch: async <T>() => ({ data: null }) as T,
  };
  await runAgentsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { search: "copy", limit: "1" },
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.agents.length, 1);
  assert.equal(parsed.agents[0].id, "agent-2");
});

test("agents list emits a stable JSON collection", async () => {
  const output: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: [createAgent()] }) as T,
    post: async <T>() => ({ data: null }) as T,
    patch: async <T>() => ({ data: null }) as T,
  };
  await runAgentsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  assert.deepEqual(JSON.parse(output.join("")), {
    agents: [createAgent()],
  });
});

test("agents hire fetches the input schema and posts a job", async () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      calls.push({ method: "GET", path });
      return { data: { type: "object", properties: {} } } as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return {
        data: { id: "job-1", agentId: "agent-1", status: "PENDING" },
      } as T;
    },
    patch: async <T>() => ({ data: null }) as T,
  };
  const output: string[] = [];
  await runAgentsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "hire",
    positionalId: "agent-1",
    options: { "input-json": '{"query":"hi"}' },
  });
  assert.equal(calls[0]?.path, "/v1/agents/agent-1/input-schema");
  const posted = calls.find((call) => call.method === "POST");
  assert.equal(posted?.path, "/v1/agents/agent-1/jobs");
  const body = posted?.body as { inputSchema: unknown; inputData: unknown };
  assert.deepEqual(body.inputSchema, { type: "object", properties: {} });
  assert.deepEqual(body.inputData, { query: "hi" });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.job.id, "job-1");
  assert.equal(parsed.job.agentId, "agent-1");
});

test("agents hire requires an agent id and input", async () => {
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>() => ({ data: {} }) as T,
  };
  await assert.rejects(
    () =>
      runAgentsCommand({
        client,
        stdout: { write() {} },
        subcommand: "hire",
        options: { "input-json": "{}" },
      }),
    /agent id is required/,
  );
  await assert.rejects(
    () =>
      runAgentsCommand({
        client,
        stdout: { write() {} },
        subcommand: "hire",
        positionalId: "agent-1",
      }),
    /--input-json or --input-file is required/,
  );
});

test("agents hire forwards max-credits and name to the job request", async () => {
  let body: { maxCredits?: unknown; name?: unknown } | undefined;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: { type: "object" } }) as T,
    post: async <T>(_path: string, requestBody: unknown) => {
      body = requestBody as typeof body;
      return { data: { id: "job-1", agentId: "agent-1" } } as T;
    },
    patch: async <T>() => ({ data: null }) as T,
  };
  await runAgentsCommand({
    client,
    stdout: { write() {} },
    json: true,
    subcommand: "hire",
    positionalId: "agent-1",
    options: { "input-json": "{}", "max-credits": "50", name: "Nightly" },
  });
  assert.equal(body?.maxCredits, 50);
  assert.equal(body?.name, "Nightly");
});

test("agents hire reads input from a file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sokosumi-hire-"));
  const file = join(dir, "input.json");
  writeFileSync(file, JSON.stringify({ from: "file" }));
  let body: { inputData?: unknown } | undefined;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: { type: "object" } }) as T,
    post: async <T>(_path: string, requestBody: unknown) => {
      body = requestBody as typeof body;
      return { data: { id: "job-1", agentId: "agent-1" } } as T;
    },
    patch: async <T>() => ({ data: null }) as T,
  };
  await runAgentsCommand({
    client,
    stdout: { write() {} },
    json: true,
    subcommand: "hire",
    positionalId: "agent-1",
    options: { "input-file": file },
  });
  assert.deepEqual(body?.inputData, { from: "file" });
});
