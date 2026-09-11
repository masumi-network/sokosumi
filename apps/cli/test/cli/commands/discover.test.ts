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
  assert.ok(result.commands.includes("jobs input"));
});

test("TestV55 discover sanitizes the API URL in JSON and text output", async () => {
  const customConfig = {
    ...config,
    target: "custom" as const,
    apiUrl:
      "https://user:password@host/api?api_key=secret&region=west#fragment",
  };

  for (const json of [true, false]) {
    const output: string[] = [];
    await runDiscoverCommand({
      config: customConfig,
      stdout: { write: (value) => output.push(value) },
      json,
    });

    assert.ok(output.join("").includes("https://host/api?region=west"));
    assert.doesNotMatch(output.join(""), /user|password|secret|fragment/i);
  }
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

test("TestV47 discover JSON redacts credential assignments in errors", async () => {
  const apiKey = "discover-api-key";
  const refreshToken = "discover-refresh-token";
  const output: string[] = [];
  const client = {
    get: async <_T>() => {
      throw new Error(
        `Core API failed: apiKey=${apiKey} refreshToken=${refreshToken} ordinary detail`,
      );
    },
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    delete: async <T>() => ({}) as T,
  };

  await runDiscoverCommand({
    config,
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
  });

  const serialized = output.join("");
  assert.doesNotMatch(serialized, new RegExp(apiKey));
  assert.doesNotMatch(serialized, new RegExp(refreshToken));
  assert.match(serialized, /ordinary detail/);
  assert.deepEqual(JSON.parse(serialized).errors, [
    {
      resource: "agents",
      message:
        "Core API failed: apiKey: [REDACTED] refreshToken: [REDACTED] ordinary detail",
    },
    {
      resource: "coworkers",
      message:
        "Core API failed: apiKey: [REDACTED] refreshToken: [REDACTED] ordinary detail",
    },
    {
      resource: "jobs",
      message:
        "Core API failed: apiKey: [REDACTED] refreshToken: [REDACTED] ordinary detail",
    },
  ]);
});
