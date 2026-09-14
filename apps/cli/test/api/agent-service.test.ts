import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  createAgentJob,
  fetchAgentInputSchema,
  fetchAgentJobs,
  fetchAgents,
} from "../../src/api/services/agent-service.js";

function createClient(response: unknown, calls: string[]): CoreHttpClient {
  return {
    get: async <T>(pathname: string) => {
      calls.push(pathname);
      return response as T;
    },
    post: async <T>() => undefined as T,
    patch: async <T>() => undefined as T,
    delete: async <T>() => undefined as T,
  };
}

test("fetchAgents maps GET /v1/agents response data to typed agents", async () => {
  const calls: string[] = [];
  const result = await fetchAgents(
    createClient(
      {
        data: [
          {
            id: "agent-1",
            name: "Researcher",
            status: "ONLINE",
            isNew: true,
            isShown: true,
            price: { credits: 5, includedFee: 1 },
            tags: [{ name: "research" }],
          },
          null,
        ],
        meta: { requestId: "request-1" },
      },
      calls,
    ),
  );

  assert.deepEqual(calls, ["/v1/agents"]);
  assert.deepEqual(result.response.meta, { requestId: "request-1" });
  assert.equal(result.agents.length, 2);
  assert.equal(result.agents[0]?.id, "agent-1");
  assert.equal(result.agents[0]?.price.credits, 5);
  assert.equal(result.agents[1]?.id, null);
});

test("fetchAgentJobs encodes agent IDs and maps jobs", async () => {
  const calls: string[] = [];
  const result = await fetchAgentJobs(
    createClient({ data: [{ id: "job-1", agentId: "agent/1" }] }, calls),
    "agent/1",
  );

  assert.deepEqual(calls, ["/v1/agents/agent%2F1/jobs"]);
  assert.deepEqual(result.jobs, [
    {
      id: "job-1",
      agentId: "agent/1",
      status: null,
      name: null,
      result: null,
      createdAt: null,
      updatedAt: null,
    },
  ]);
});

test("fetchAgentInputSchema extracts grouped input fields", async () => {
  const calls: string[] = [];
  const result = await fetchAgentInputSchema(
    createClient(
      {
        data: {
          input_groups: [{ input_data: [{ name: "query" }] }],
        },
      },
      calls,
    ),
    "agent/1",
  );

  assert.deepEqual(calls, ["/v1/agents/agent%2F1/input-schema"]);
  assert.deepEqual(result.fields, [{ name: "query" }]);
});

test("createAgentJob validates and posts the typed job payload", async () => {
  const calls: string[] = [];
  const client = createClient(
    {
      data: {
        id: "job-1",
        agentId: "agent-1",
        status: "PENDING",
      },
    },
    calls,
  );
  let body: unknown;
  client.post = async <T>(pathname: string, payload: unknown) => {
    calls.push(pathname);
    body = payload;
    return {
      data: {
        id: "job-1",
        agentId: "agent-1",
        status: "PENDING",
      },
    } as T;
  };

  const result = await createAgentJob(client, "agent-1", {
    inputSchema: { fields: [] },
    inputData: { query: "hello" },
    maxCredits: 8,
    name: "  Demo  ",
  });

  assert.deepEqual(calls, ["/v1/agents/agent-1/jobs"]);
  assert.deepEqual(body, {
    inputSchema: { fields: [] },
    inputData: { query: "hello" },
    maxCredits: 8,
    name: "Demo",
  });
  assert.equal(result.job.id, "job-1");
});
