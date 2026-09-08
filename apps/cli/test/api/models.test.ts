import assert from "node:assert/strict";
import test from "node:test";
import { parseAgent } from "../../src/api/models/agent.js";
import { parseAgentJob } from "../../src/api/models/agent-job.js";
import { parseApiResponse } from "../../src/api/models/api-response.js";

test("parses an API envelope and preserves metadata", () => {
  assert.deepEqual(
    parseApiResponse<{ id: string }>({
      data: { id: "agent-1" },
      meta: { requestId: "request-1" },
    }),
    { data: { id: "agent-1" }, meta: { requestId: "request-1" } },
  );
});

test("tolerates null and unexpected agent values with safe defaults", () => {
  assert.deepEqual(parseAgent(null), {
    id: null,
    createdAt: null,
    updatedAt: null,
    name: null,
    description: null,
    status: null,
    isNew: false,
    isShown: false,
    price: { credits: null, includedFee: null },
    tags: [],
  });

  assert.deepEqual(
    parseAgent({
      id: "agent-1",
      name: "Researcher",
      price: { credits: 12, includedFee: 2 },
      tags: [{ name: "research" }, null, "unexpected"],
      isNew: true,
      isShown: true,
    }),
    {
      id: "agent-1",
      createdAt: null,
      updatedAt: null,
      name: "Researcher",
      description: null,
      status: null,
      isNew: true,
      isShown: true,
      price: { credits: 12, includedFee: 2 },
      tags: [{ name: "research" }, { name: null }, { name: null }],
    },
  );
});

test("tolerates null and unexpected agent job values", () => {
  assert.deepEqual(parseAgentJob(null), {
    id: null,
    agentId: null,
    status: null,
    name: null,
    createdAt: null,
    updatedAt: null,
  });
  assert.deepEqual(
    parseAgentJob({ id: "job-1", agent_id: "agent-1", status: "pending" }),
    {
      id: "job-1",
      agentId: "agent-1",
      status: "pending",
      name: null,
      createdAt: null,
      updatedAt: null,
    },
  );
});
