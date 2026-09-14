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

test("jobs input submits JSON and emits the submitted input", async () => {
  const output: string[] = [];
  const calls: { path: string; body: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: null }) as T,
    post: async <T>(path: string, body: unknown) => {
      calls.push({ path, body });
      return {
        data: { id: "input-1", inputHash: "hash-1", signature: "signature-1" },
      } as T;
    },
    patch: async <T>() => ({ data: null }) as T,
    delete: async <T>() => ({ data: null }) as T,
  };

  await runJobsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "input",
    positionalId: "job/1",
    options: {
      "event-id": "event-1",
      "input-json": '{"answer":"yes"}',
    },
  });

  assert.deepEqual(calls, [
    {
      path: "/v1/jobs/job%2F1/inputs",
      body: { eventId: "event-1", inputData: { answer: "yes" } },
    },
  ]);
  assert.deepEqual(JSON.parse(output.join("")), {
    jobId: "job/1",
    eventId: "event-1",
    input: { id: "input-1", inputHash: "hash-1", signature: "signature-1" },
  });
});

test("jobs input validates its event ID and JSON input", async () => {
  const client = clientWith({ data: null });

  await assert.rejects(
    () =>
      runJobsCommand({
        client,
        stdout: { write() {} },
        subcommand: "input",
        positionalId: "job-1",
        options: { "input-json": '{"answer":"yes"}' },
      }),
    /--event-id is required/,
  );
  await assert.rejects(
    () =>
      runJobsCommand({
        client,
        stdout: { write() {} },
        subcommand: "input",
        positionalId: "job-1",
        options: { "event-id": "event-1" },
      }),
    /--input-json or --input-file is required/,
  );
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

test("jobs get text surfaces the newest Core event result", async () => {
  const output: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      let data: unknown = null;
      if (path === "/v1/jobs/job-1") {
        data = { id: "job-1", status: "PROCESSING" };
      } else if (path === "/v1/jobs/job-1/events") {
        data = [
          {
            id: "event-2",
            createdAt: "2026-01-01T00:01:00.000Z",
            updatedAt: "2026-01-01T00:02:00.000Z",
            status: "RUNNING",
            inputSchema: null,
            input: null,
            result: "Newest feedback.",
            files: [],
            links: [],
          },
          {
            id: "event-1",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:01:00.000Z",
            status: "AWAITING_INPUT",
            inputSchema: '{"type":"object"}',
            input: null,
            result: "Oldest feedback.",
            files: [],
            links: [],
          },
        ];
      } else if (
        path === "/v1/jobs/job-1/files" ||
        path === "/v1/jobs/job-1/links"
      ) {
        data = [];
      }
      return { data } as T;
    },
    post: async <T>() => ({ data: null }) as T,
    patch: async <T>() => ({ data: null }) as T,
    delete: async <T>() => ({ data: null }) as T,
  };

  await runJobsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    subcommand: "get",
    positionalId: "job-1",
    options: { details: true },
  });

  assert.match(output.join(""), /latest event: Newest feedback\./);
  assert.doesNotMatch(output.join(""), /latest event: Oldest feedback\./);
});
