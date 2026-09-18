import assert from "node:assert/strict";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runTasksCommand } from "../../../src/cli/commands/tasks.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => response as T,
    patch: async <T>() => response as T,
    delete: async <T>() => response as T,
  };
}

test("tasks list emits JSON", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: clientWith({
      data: [
        { id: "task-1", name: "Build", status: "READY", coworkerId: "cw-1" },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].id, "task-1");
  assert.equal(parsed.tasks[0].status, "READY");
});

test("tasks get requires an id", async () => {
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "get",
      }),
    /task id is required/,
  );
});

test("tasks create posts the payload and returns the task with details", async () => {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      calls.push({ method: "GET", path });
      return { data: [] } as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return { data: { id: "task-1", name: "Build", status: "READY" } } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
    delete: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "create",
    options: {
      "coworker-id": "cw-1",
      description: "Do the thing",
      name: "Build",
      status: "READY",
    },
  });
  const created = calls.find((call) => call.method === "POST");
  assert.equal(created?.path, "/v1/tasks");
  assert.deepEqual(created?.body, {
    coworkerId: "cw-1",
    description: "Do the thing",
    name: "Build",
    status: "READY",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.task.id, "task-1");
  assert.deepEqual(parsed.events, []);
  assert.deepEqual(parsed.jobs, []);
});

test("tasks create requires a coworker id and a description", async () => {
  const client = clientWith({ data: {} });
  await assert.rejects(
    () =>
      runTasksCommand({
        client,
        stdout: { write() {} },
        subcommand: "create",
        options: { description: "no coworker" },
      }),
    /--coworker-id is required/,
  );
  await assert.rejects(
    () =>
      runTasksCommand({
        client,
        stdout: { write() {} },
        subcommand: "create",
        options: { "coworker-id": "cw-1" },
      }),
    /--description is required/,
  );
});

test("tasks get returns the task with its events and jobs", async () => {
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.endsWith("/events"))
        return { data: [{ id: "ev-1", status: "READY" }] } as T;
      if (path.endsWith("/jobs")) return { data: [{ id: "job-1" }] } as T;
      return { data: { id: "task-1", name: "Build", status: "READY" } } as T;
    },
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>() => ({ data: {} }) as T,
    delete: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "get",
    positionalId: "task-1",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.task.id, "task-1");
  assert.equal(parsed.events[0].id, "ev-1");
  assert.equal(parsed.jobs[0].id, "job-1");
});

test("tasks events lists a task's events", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: clientWith({ data: [{ id: "ev-1", status: "READY" }] }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "events",
    positionalId: "task-1",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.events.length, 1);
  assert.equal(parsed.events[0].id, "ev-1");
});

test("tasks jobs lists a task's jobs", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: clientWith({ data: [{ id: "job-1" }] }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "jobs",
    positionalId: "task-1",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0].id, "job-1");
});

test("tasks comment posts the comment and status and returns the event", async () => {
  let body: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>(_path: string, requestBody: unknown) => {
      body = requestBody;
      return { data: { id: "ev-9" } } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
    delete: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "comment",
    positionalId: "task-1",
    options: { comment: "looks good", status: "READY" },
  });
  assert.deepEqual(body, { comment: "looks good", status: "READY" });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.event.id, "ev-9");
});

test("tasks comment requires a comment or a status", async () => {
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "comment",
        positionalId: "task-1",
      }),
    /--comment or --status is required/,
  );
});

test("tasks create rejects an invalid status", async () => {
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "create",
        options: {
          "coworker-id": "cw-1",
          description: "x",
          status: "BOGUS",
        },
      }),
    /--status must be one of/,
  );
});

test("tasks get still emits the task when a details fetch fails", async () => {
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.endsWith("/events")) throw new Error("events boom");
      if (path.endsWith("/jobs")) return { data: [] } as T;
      return { data: { id: "task-1", name: "Build", status: "READY" } } as T;
    },
    post: async <T>() => ({ data: {} }) as T,
    patch: async <T>() => ({ data: {} }) as T,
    delete: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "get",
    positionalId: "task-1",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.task.id, "task-1");
  assert.equal(parsed.detailsErrors[0].resource, "events");
  assert.match(parsed.detailsErrors[0].message, /events boom/);
});
