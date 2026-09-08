import assert from "node:assert/strict";
import test from "node:test";

import { runDiscoverCommand } from "../../../src/cli/commands/discover.js";

const config = {
  target: "mainnet" as const,
  apiUrl: "https://api.sokosumi.com",
  authBaseUrl: "https://api.sokosumi.com/auth",
  clientId: "mainnet-client",
  clientSecret: "",
};

test("discover JSON lists the current command catalog", async () => {
  const output: string[] = [];
  await runDiscoverCommand({
    config,
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  const result = JSON.parse(output.join("")) as {
    apiUrl: string;
    environment: string;
    commands: string[];
  };
  assert.equal(result.apiUrl, config.apiUrl);
  assert.equal(result.environment, "mainnet");
  assert.ok(result.commands.includes("agents list"));
});

test("discover collects Core resources with stable JSON fields", async () => {
  const output: string[] = [];
  await runDiscoverCommand({
    config,
    client: {
      get: async <T>(pathname: string) => {
        const data =
          pathname === "/v1/agents"
            ? [{ id: "agent-1", name: "Researcher", status: "ONLINE" }]
            : pathname === "/v1/coworkers"
              ? [{ id: "coworker-1", name: "Worker", capabilities: ["tasks"] }]
              : [{ id: "job-1", name: "Job", status: "RUNNING" }];
        return { data } as T;
      },
      post: async <T>() => ({ data: null }) as T,
      patch: async <T>() => ({ data: null }) as T,
      delete: async <T>() => ({ data: null }) as T,
    },
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  const result = JSON.parse(output.join("")) as {
    agents: { id: string }[];
    coworkers: { id: string }[];
    jobs: { id: string }[];
  };
  assert.equal(result.agents[0]?.id, "agent-1");
  assert.equal(result.coworkers[0]?.id, "coworker-1");
  assert.equal(result.jobs[0]?.id, "job-1");
});
