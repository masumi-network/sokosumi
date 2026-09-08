import assert from "node:assert/strict";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runJobsCommand } from "../../../src/cli/commands/jobs.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => response as T,
    patch: async <T>() => response as T,
    delete: async <T>() => response as T,
  };
}

test("jobs list emits JSON", async () => {
  const output: string[] = [];
  await runJobsCommand({
    client: clientWith({
      data: [{ id: "job-1", name: "Run", status: "READY", agentId: "agent-1" }],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0].id, "job-1");
  assert.equal(parsed.jobs[0].agentId, "agent-1");
});

test("jobs get requires an id", async () => {
  await assert.rejects(
    () =>
      runJobsCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "get",
      }),
    /job id is required/,
  );
});
