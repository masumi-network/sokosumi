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
    delete: (path) => handle({ method: "DELETE", path }),
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  await runTasksCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { search: "review" },
  });
  assert.equal(paths[0], "/v1/tasks?q=review&limit=100");
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

test("tasks list text shows short id and person assignee", async () => {
  const output: string[] = [];
  await runTasksCommand({
    client: clientWith({
      data: [
        {
          id: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
          identifier: "SOK-12",
          name: "Spec",
          status: "READY",
          assigneeUserId: "user-1",
        },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
  });
  const text = output.join("");
  assert.match(text, /Spec \[SOK-12\]/);
  assert.match(text, /assignee: user-1/);
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
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
    delete: async () => {
      throw new Error("Unexpected DELETE");
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

test("tasks list follows cursors until Core has no more pages", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: recordingClient(calls, (call) =>
      call.path.includes("cursor=c1")
        ? { data: [{ id: "t-2" }] }
        : {
            data: [{ id: "t-1" }],
            meta: { pagination: { nextCursor: "c1" } },
          },
    ),
    stdout: { write: (value) => output.push(value) },
    json: true,
  });
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/v1/tasks?limit=100", "/v1/tasks?limit=100&cursor=c1"],
  );
  assert.deepEqual(
    JSON.parse(output.join("")).tasks.map((task: { id: string }) => task.id),
    ["t-1", "t-2"],
  );
});

test("tasks list --limit caps page size and stops at the limit", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  const page = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `${prefix}${index}` }));
  await runTasksCommand({
    client: recordingClient(calls, (call) =>
      call.path.includes("cursor=")
        ? { data: page("b", 50), meta: { pagination: { nextCursor: "c2" } } }
        : { data: page("a", 100), meta: { pagination: { nextCursor: "c1" } } },
    ),
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { limit: "150" },
  });
  assert.deepEqual(
    calls.map((call) => call.path),
    ["/v1/tasks?limit=100", "/v1/tasks?limit=50&cursor=c1"],
  );
  assert.equal(JSON.parse(output.join("")).tasks.length, 150);
});

test("tasks list filters by project, person, and sort", async () => {
  const calls: Call[] = [];
  await runTasksCommand({
    client: recordingClient(calls, () => ({ data: [] })),
    stdout: { write() {} },
    json: true,
    options: {
      "project-id": PEER_UUID,
      "assignee-user-id": "user-1",
      sort: "PRIORITY",
      status: "READY",
      limit: "100",
    },
  });
  assert.equal(
    calls[0]?.path,
    `/v1/tasks?limit=100&projectId=${PEER_UUID}&assigneeUserId=user-1&sort=priority&status=READY`,
  );
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: [] }),
        stdout: { write() {} },
        options: { sort: "name" },
      }),
    /--sort must be one of: createdAt, updatedAt, priority/,
  );
  await assert.rejects(
    () =>
      runTasksCommand({
        client: clientWith({ data: [] }),
        stdout: { write() {} },
        options: { sort: "priority" },
      }),
    /--sort priority needs --limit/,
  );
});

function linksClient(
  calls: Call[],
  links: unknown[],
  failPost = false,
): CoreHttpClient {
  return recordingClient(calls, (call) => {
    if (call.method === "GET" && call.path === "/v1/tasks/SOK4-79")
      return { data: { id: PEER_UUID } };
    if (call.method === "GET") return { data: links };
    if (call.method === "POST" && failPost) throw new Error("Core said no");
    if (call.method === "DELETE") return { data: { deleted: true } };
    return { data: { id: "tl-new", relation: "child" } };
  });
}

const PARENT_LINK = {
  id: "tl-1",
  relation: "parent",
  note: "epic",
  peerTask: { id: PEER_UUID, identifier: "SOK4-79" },
};
const RELATED_LINK = {
  id: "tl-2",
  relation: "related",
  note: null,
  peerTask: { id: PEER_UUID, identifier: "SOK4-79" },
};

test("tasks unlink deletes the link to the --to task", async () => {
  const calls: Call[] = [];
  await runTasksCommand({
    client: linksClient(calls, [PARENT_LINK]),
    stdout: { write() {} },
    json: true,
    subcommand: "unlink",
    positionalId: TASK_UUID,
    options: { to: "SOK4-79" },
  });
  assert.deepEqual(calls.at(-1), {
    method: "DELETE",
    path: `/v1/tasks/${TASK_UUID}/links/tl-1`,
  });
});

test("tasks unlink needs --relation when several links reach the --to task", async () => {
  const run = (options: Record<string, string>, calls: Call[] = []) =>
    runTasksCommand({
      client: linksClient(calls, [PARENT_LINK, RELATED_LINK]),
      stdout: { write() {} },
      subcommand: "unlink",
      positionalId: TASK_UUID,
      options,
    });
  await assert.rejects(
    () => run({ to: PEER_UUID }),
    /2 links to .* \(parent, related\); pass --relation/,
  );
  await assert.rejects(
    () => run({ to: PEER_UUID, relation: "blocks" }),
    /No blocks link/,
  );
  const calls: Call[] = [];
  await run({ to: PEER_UUID, relation: "related" }, calls);
  assert.equal(calls.at(-1)?.path, `/v1/tasks/${TASK_UUID}/links/tl-2`);
});

test("tasks relink replaces the link and keeps its note", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: linksClient(calls, [PARENT_LINK]),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "relink",
    positionalId: TASK_UUID,
    options: { to: "SOK4-79", relation: "child" },
  });
  assert.deepEqual(
    calls.filter((call) => call.method !== "GET"),
    [
      { method: "DELETE", path: `/v1/tasks/${TASK_UUID}/links/tl-1` },
      {
        method: "POST",
        path: `/v1/tasks/${TASK_UUID}/links`,
        body: { toTaskId: PEER_UUID, relation: "child", note: "epic" },
      },
    ],
  );
  assert.equal(JSON.parse(output.join("")).link.id, "tl-new");
});

test("tasks relink names the restore command when the new link fails", async () => {
  await assert.rejects(
    () =>
      runTasksCommand({
        client: linksClient([], [PARENT_LINK], true),
        stdout: { write() {} },
        subcommand: "relink",
        positionalId: TASK_UUID,
        options: { to: PEER_UUID, relation: "child" },
      }),
    new RegExp(
      `Removed the parent link but could not create the child link: Core said no. Restore it with: sokosumi tasks link ${TASK_UUID} --relation parent --to ${PEER_UUID} --note "epic"`,
    ),
  );
});

test("tasks archive resolves the id and archives the task", async () => {
  const calls: Call[] = [];
  const output: string[] = [];
  await runTasksCommand({
    client: recordingClient(calls, (call) =>
      call.method === "GET"
        ? { data: { id: TASK_UUID } }
        : { data: { id: TASK_UUID, archivedAt: "2026-10-19T00:00:00.000Z" } },
    ),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "archive",
    positionalId: "SOK4-71",
  });
  assert.deepEqual(calls.at(-1), {
    method: "DELETE",
    path: `/v1/tasks/${TASK_UUID}`,
  });
  assert.equal(JSON.parse(output.join("")).task.id, TASK_UUID);
});
