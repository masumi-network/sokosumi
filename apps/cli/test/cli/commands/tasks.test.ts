import assert from "node:assert/strict";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runTasksCommand } from "../../../src/cli/commands/tasks.js";

const TASK_UUID = "01a12fd2-9136-74bc-8c50-fe4bd659d4ae";
const PEER_UUID = "01a12fd2-c094-70a1-a2be-182f8cd09ac3";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}

function recordingClient(
  calls: Call[],
  respond: (call: Call) => unknown = () => ({ data: {} }),
): CoreHttpClient {
  const handle = async <T>(call: Call) => {
    calls.push(call);
    return respond(call) as T;
  };
  return {
    get: (path) => handle({ method: "GET", path }),
    post: (path, body) => handle({ method: "POST", path, body }),
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: (path, body) => handle({ method: "PATCH", path, body }),
  };
}

// GET /v1/tasks/SOK4-71 resolves identifiers in Core; other routes need the UUID.
function resolvingClient(calls: Call[], writeResponse: unknown = { data: {} }) {
  return recordingClient(calls, (call) => {
    if (call.method !== "GET") return writeResponse;
    if (call.path === "/v1/tasks/SOK4-71")
      return { data: { id: TASK_UUID, identifier: "SOK4-71" } };
    if (call.path === "/v1/tasks/SOK4-79")
      return { data: { id: PEER_UUID, identifier: "SOK4-79" } };
    return { data: [] };
  });
}

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => response as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => response as T,
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

test("tasks list sends search as server q and keeps server matches", async () => {
  const output: string[] = [];
  const paths: string[] = [];
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      paths.push(path);
      return {
        data: [
          { id: "task-1", name: "Build", status: "READY", coworkerId: "cw-1" },
        ],
      } as T;
    },
    post: async <T>() => ({ data: {} }) as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { search: "review" },
  });
  assert.equal(paths[0], "/v1/tasks?q=review");
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].id, "task-1");
  assert.equal(parsed.tasks[0].name, "Build");
});

test("tasks list still applies client limit", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: clientWith({
      data: [
        { id: "task-1", name: "Build", status: "READY" },
        { id: "task-2", name: "Ship", status: "READY" },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { limit: "1" },
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.tasks.length, 1);
  assert.equal(parsed.tasks[0].id, "task-1");
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
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
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
    assigneeId: "cw-1",
    description: "Do the thing",
    name: "Build",
    status: "READY",
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.task.id, "task-1");
  assert.deepEqual(parsed.events, []);
  assert.deepEqual(parsed.jobs, []);
});

test("tasks create requires a description", async () => {
  const client = clientWith({ data: {} });
  await assert.rejects(
    () =>
      runTasksCommand({
        client,
        stdout: { write() {} },
        subcommand: "create",
        options: { "coworker-id": "cw-1" },
      }),
    /--description or --description-file is required/,
  );
});

test("tasks get returns the task with its events and jobs", async () => {
  const client: CoreHttpClient = {
    get: async <T>(path: string) => {
      if (path.includes("/events"))
        return { data: [{ id: "ev-1", status: "READY" }] } as T;
      if (path.endsWith("/jobs")) return { data: [{ id: "job-1" }] } as T;
      return { data: { id: "task-1", name: "Build", status: "READY" } } as T;
    },
    post: async <T>() => ({ data: {} }) as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
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
    positionalId: TASK_UUID,
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
    positionalId: TASK_UUID,
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
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "comment",
    positionalId: TASK_UUID,
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
        positionalId: TASK_UUID,
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
      if (path.includes("/events")) throw new Error("events boom");
      if (path.endsWith("/jobs")) return { data: [] } as T;
      return { data: { id: "task-1", name: "Build", status: "READY" } } as T;
    },
    post: async <T>() => ({ data: {} }) as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
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

test("tasks create sends priority, project, and a human assignee", async () => {
  const calls: Call[] = [];
  await runTasksCommand({
    client: recordingClient(calls, (call) =>
      call.method === "POST"
        ? { data: { id: TASK_UUID, identifier: "SOK4-80", priority: "HIGH" } }
        : { data: [] },
    ),
    stdout: { write() {} },
    json: true,
    subcommand: "create",
    options: {
      description: "Spec",
      priority: "high",
      "project-id": PEER_UUID,
      "assignee-user-id": "user-1",
    },
  });
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, {
    description: "Spec",
    priority: "HIGH",
    projectId: PEER_UUID,
    assigneeUserId: "user-1",
  });
});

test("tasks create reads the description from a file", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(join(tmpdir(), "soko-tasks-"));
  const file = join(dir, "spec.md");
  await writeFile(file, "# Spec\n\nLong body\n");
  const calls: Call[] = [];
  await runTasksCommand({
    client: recordingClient(calls, () => ({ data: [] })),
    stdout: { write() {} },
    json: true,
    subcommand: "create",
    options: { "description-file": file },
  });
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, {
    description: "# Spec\n\nLong body\n",
  });
});

test("tasks create rejects conflicting assignees, bad priority, and two descriptions", async () => {
  const run = (options: Record<string, string>) =>
    runTasksCommand({
      client: clientWith({ data: {} }),
      stdout: { write() {} },
      subcommand: "create",
      options: { description: "x", ...options },
    });
  await assert.rejects(
    () => run({ "coworker-id": "cw-1", "assignee-user-id": "user-1" }),
    /either --coworker-id or --assignee-user-id/,
  );
  await assert.rejects(
    () => run({ priority: "P1" }),
    /--priority must be one of: URGENT, HIGH, MEDIUM, LOW, NONE/,
  );
  await assert.rejects(
    () => run({ "description-file": "spec.md" }),
    /either --description or --description-file/,
  );
});

test("tasks task json keeps identifier, priority, project, and human assignee", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: recordingClient([], (call) =>
      call.path === `/v1/tasks/${TASK_UUID}`
        ? {
            data: {
              id: TASK_UUID,
              identifier: "SOK4-71",
              priority: "MEDIUM",
              projectId: PEER_UUID,
              assigneeUserId: "user-1",
            },
          }
        : { data: [] },
    ),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "get",
    positionalId: TASK_UUID,
  });
  const { task } = JSON.parse(output.join(""));
  assert.equal(task.identifier, "SOK4-71");
  assert.equal(task.priority, "MEDIUM");
  assert.equal(task.projectId, PEER_UUID);
  assert.equal(task.assigneeUserId, "user-1");
});

test("tasks update resolves an identifier and patches the given fields", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: resolvingClient(calls, {
      data: { id: TASK_UUID, identifier: "SOK4-71", priority: "LOW" },
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "update",
    positionalId: "SOK4-71",
    options: { name: "Renamed", priority: "low", "coworker-id": "cw-2" },
  });
  assert.deepEqual(calls, [
    { method: "GET", path: "/v1/tasks/SOK4-71" },
    {
      method: "PATCH",
      path: `/v1/tasks/${TASK_UUID}`,
      body: { name: "Renamed", priority: "LOW", assigneeId: "cw-2" },
    },
  ]);
  assert.equal(JSON.parse(output.join("")).task.priority, "LOW");
});

test("tasks update requires a field to change", async () => {
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "update",
        positionalId: TASK_UUID,
      }),
    /at least one of --name/,
  );
});

test("tasks comment resolves an identifier before posting the event", async () => {
  const calls: Call[] = [];
  await runTasksCommand({
    client: resolvingClient(calls, { data: { id: "ev-1" } }),
    stdout: { write() {} },
    json: true,
    subcommand: "comment",
    positionalId: "SOK4-71",
    options: { status: "RUNNING", comment: "Implementing" },
  });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: `/v1/tasks/${TASK_UUID}/events`,
    body: { status: "RUNNING", comment: "Implementing" },
  });
});

test("tasks links lists a task's links", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: recordingClient(calls, () => ({
      data: [
        {
          id: "tl-1",
          relation: "child",
          peerTask: { id: PEER_UUID, identifier: "SOK4-79", name: "Builder" },
          note: null,
        },
      ],
    })),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "links",
    positionalId: TASK_UUID,
  });
  assert.deepEqual(calls, [
    { method: "GET", path: `/v1/tasks/${TASK_UUID}/links` },
  ]);
  const { links } = JSON.parse(output.join(""));
  assert.equal(links[0].peerTask.identifier, "SOK4-79");
});

test("tasks link resolves both tasks and posts the relation", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: resolvingClient(calls, {
      data: { id: "tl-1", relation: "child", peerTask: { id: PEER_UUID } },
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "link",
    positionalId: "SOK4-71",
    options: { to: "SOK4-79", relation: "child", note: "Part of builder" },
  });
  assert.deepEqual(calls.at(-1), {
    method: "POST",
    path: `/v1/tasks/${TASK_UUID}/links`,
    body: { toTaskId: PEER_UUID, relation: "child", note: "Part of builder" },
  });
  assert.equal(JSON.parse(output.join("")).link.id, "tl-1");
});

test("tasks link validates --to and --relation", async () => {
  const run = (options: Record<string, string>) =>
    runTasksCommand({
      client: clientWith({ data: {} }),
      stdout: { write() {} },
      subcommand: "link",
      positionalId: TASK_UUID,
      options,
    });
  await assert.rejects(() => run({ relation: "parent" }), /--to is required/);
  await assert.rejects(
    () => run({ to: PEER_UUID, relation: "child_of" }),
    /--relation must be one of: related, blocks, blocked_by, parent, child, duplicate/,
  );
});

test("tasks update --unassign and --clear-project send nulls", async () => {
  const calls: Call[] = [];
  await runTasksCommand({
    client: recordingClient(calls, () => ({ data: { id: TASK_UUID } })),
    stdout: { write() {} },
    json: true,
    subcommand: "update",
    positionalId: TASK_UUID,
    options: { unassign: true, "clear-project": true },
  });
  assert.deepEqual(calls, [
    {
      method: "PATCH",
      path: `/v1/tasks/${TASK_UUID}`,
      body: { assigneeId: null, projectId: null },
    },
  ]);
});

test("tasks update rejects clearing and setting the same field", async () => {
  const run = (options: Record<string, string | boolean>) =>
    runTasksCommand({
      client: clientWith({ data: {} }),
      stdout: { write() {} },
      subcommand: "update",
      positionalId: TASK_UUID,
      options,
    });
  await assert.rejects(
    () => run({ unassign: true, "coworker-id": "cw-1" }),
    /--unassign cannot be combined with --coworker-id or --assignee-user-id/,
  );
  await assert.rejects(
    () => run({ unassign: true, "assignee-user-id": "user-1" }),
    /--unassign cannot be combined/,
  );
  await assert.rejects(
    () => run({ "clear-project": true, "project-id": PEER_UUID }),
    /--clear-project cannot be combined with --project-id/,
  );
});
