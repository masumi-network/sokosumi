import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../../src/api/http-client.js";
import type { Agent } from "../../../src/api/models/agent.js";
import {
  filterAgents,
  runAgentsCommand,
} from "../../../src/cli/commands/agents.js";

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

test("filters agents by searchable fields and applies a limit", () => {
  const agents = [
    createAgent(),
    createAgent({ id: "agent-2", name: "Writer", tags: [{ name: "copy" }] }),
  ];
  assert.deepEqual(
    filterAgents(agents, { search: "copy", limit: 1 }).map((agent) => agent.id),
    ["agent-2"],
  );
});

test("agents list emits a stable JSON collection", async () => {
  const output: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: [createAgent()] }) as T,
    post: async <T>() => ({ data: null }) as T,
    patch: async <T>() => ({ data: null }) as T,
    delete: async <T>() => ({ data: null }) as T,
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
