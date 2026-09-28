import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  completeRuntimeTask,
  executeRuntimeTask,
  type RuntimeTask,
  startRuntimeTask,
} from "../../src/coworker/runtime-task.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
  signal?: AbortSignal;
}

function fixture(responses: unknown[]) {
  const calls: Call[] = [];
  async function call<T>(request: Call): Promise<T> {
    calls.push(request);
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (typeof response === "function") return response(request) as T;
    return response as T;
  }
  const client: CoreHttpClient = {
    get: (path, signal) => call({ method: "GET", path, signal }),
    post: (path, body, signal) => call({ method: "POST", path, body, signal }),
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: (path, body, signal) =>
      call({ method: "PATCH", path, body, signal }),
  };
  return { client, calls };
}

const identity = {
  data: { id: "cow-1", archivedAt: null, capabilities: ["tasks"] },
};
const task = {
  id: "task-1",
  name: "Write a greeting",
  description: "A short greeting.",
  organizationId: "org-1",
  assigneeId: "cow-1",
  assignee: { type: "coworker", id: "cow-1" },
  workspace: { id: "workspace-1", organizationId: "org-1" },
  status: "READY",
};
const context = {
  coworkerId: "cow-1",
  organizationId: "org-1",
  taskId: "task-1",
};

function event(status: string | null, extra: Record<string, unknown> = {}) {
  return {
    data: {
      id: "event-1",
      taskId: context.taskId,
      status,
      actor: { type: "coworker", id: "cow-1" },
      ...extra,
    },
  };
}

test("standalone start returns Task context only after a confirmed RUNNING event", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
  ]);
  const started = await startRuntimeTask({ ...context, client });
  assert.deepEqual(started, {
    id: task.id,
    name: task.name,
    description: task.description,
    organizationId: task.organizationId,
    assigneeId: task.assigneeId,
    status: "RUNNING",
  });
  assert.equal(calls.length, 3);
  assert.deepEqual(calls[2]?.body, { status: "RUNNING" });
});

test("standalone completion preserves the result without starting work again", async () => {
  const { client, calls } = fixture([
    identity,
    { data: { ...task, status: "RUNNING" } },
    event("COMPLETED"),
  ]);
  const signal = new AbortController().signal;
  const result = "  Existing agent's actual result.\n";
  const completed = await completeRuntimeTask({
    ...context,
    client,
    signal,
    result,
  });
  assert.deepEqual(completed, {
    taskId: task.id,
    eventId: "event-1",
    status: "COMPLETED",
    result,
  });
  assert.equal(calls.length, 3);
  assert.ok(calls.every((call) => call.signal === signal));
  assert.deepEqual(calls[2]?.body, { status: "COMPLETED", comment: result });
});

test("standalone completion rejects empty output before any authentication request", async () => {
  const { client, calls } = fixture([]);
  await assert.rejects(
    completeRuntimeTask({ ...context, client, result: " \n\t" }),
    /no result/,
  );
  assert.equal(calls.length, 0);
});

for (const operation of ["start", "complete"] as const) {
  const invoke = (client: CoreHttpClient, signal?: AbortSignal) =>
    operation === "start"
      ? startRuntimeTask({ ...context, client, signal })
      : completeRuntimeTask({ ...context, client, signal, result: "result" });

  test(`standalone ${operation} verifies the authenticated Coworker before Task access`, async () => {
    const { client, calls } = fixture([
      { data: { ...identity.data, id: "other" } },
    ]);
    await assert.rejects(invoke(client), /identity must match/);
    assert.equal(calls.length, 1);
  });

  test(`standalone ${operation} protects the selected organization`, async () => {
    const { client, calls } = fixture([
      identity,
      {
        data: {
          ...task,
          status: operation === "start" ? "READY" : "RUNNING",
          organizationId: "other",
        },
      },
    ]);
    await assert.rejects(invoke(client), /does not match/);
    assert.equal(calls.length, 2);
  });

  test(`standalone ${operation} leaves canceled Tasks unchanged`, async () => {
    const { client, calls } = fixture([
      identity,
      { data: { ...task, status: "CANCELED" } },
    ]);
    await assert.rejects(invoke(client), /Task must be/);
    assert.equal(calls.length, 2);
  });

  test(`standalone ${operation} stops if canceled during its Task read`, async () => {
    const controller = new AbortController();
    const { client, calls } = fixture([
      identity,
      () => {
        controller.abort("soko_secret_abort_reason");
        return {
          data: {
            ...task,
            status: operation === "start" ? "READY" : "RUNNING",
          },
        };
      },
    ]);
    await assert.rejects(
      invoke(client, controller.signal),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /aborted/);
        assert.doesNotMatch(error.message, /soko_secret_abort_reason/);
        return true;
      },
    );
    assert.equal(calls.length, 2);
  });

  test(`standalone ${operation} does not repeat an ambiguous write or expose upstream text`, async () => {
    const error = Object.assign(
      new Error("coworker_secret private Task text"),
      { status: 500, body: { private: "soko_secret" } },
    );
    const { client, calls } = fixture([
      identity,
      {
        data: { ...task, status: operation === "start" ? "READY" : "RUNNING" },
      },
      error,
    ]);
    await assert.rejects(invoke(client), (failure: unknown) => {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, /HTTP 500/);
      assert.doesNotMatch(
        failure.message,
        /coworker_secret|private Task text|soko_secret/,
      );
      return true;
    });
    assert.equal(calls.length, 3);
  });
}

test("standalone start refuses a Task already running", async () => {
  const { client, calls } = fixture([
    identity,
    { data: { ...task, status: "RUNNING" } },
  ]);
  await assert.rejects(
    startRuntimeTask({ ...context, client }),
    /Task must be READY/,
  );
  assert.equal(calls.length, 2);
});

test("standalone completion refuses work that never started or already completed", async () => {
  for (const status of ["READY", "COMPLETED"]) {
    const { client, calls } = fixture([
      identity,
      { data: { ...task, status } },
    ]);
    await assert.rejects(
      completeRuntimeTask({ ...context, client, result: "result" }),
      /Task must be RUNNING/,
    );
    assert.equal(calls.length, 2);
  }
});

test("standalone completion requires a matching completion event", async () => {
  const { client, calls } = fixture([
    identity,
    { data: { ...task, status: "RUNNING" } },
    event("COMPLETED", { taskId: "other" }),
  ]);
  await assert.rejects(
    completeRuntimeTask({ ...context, client, result: "result" }),
    /could not be confirmed/,
  );
  assert.equal(calls.length, 3);
});

test("runtime refuses missing IDs and pre-aborted start before any request", async () => {
  const { client, calls } = fixture([]);
  await assert.rejects(
    startRuntimeTask({
      ...context,
      taskId: " ",
      client,
    }),
    /IDs are required/,
  );
  const controller = new AbortController();
  controller.abort(new Error("secret-from-abort"));
  await assert.rejects(
    startRuntimeTask({
      ...context,
      client,
      signal: controller.signal,
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.doesNotMatch(error.message, /secret-from-abort/);
      return /aborted/.test(error.message);
    },
  );
  assert.equal(calls.length, 0);
});

for (const [name, data] of Object.entries({
  wrong_identity: { ...identity.data, id: "other" },
  archived: { ...identity.data, archivedAt: "2026-01-01" },
  missing_archive_state: { id: "cow-1", capabilities: ["tasks"] },
  missing_capability: { ...identity.data, capabilities: ["chat"] },
  malformed_capabilities: { ...identity.data, capabilities: "tasks" },
})) {
  test(`runtime refuses ${name} before reading a Task`, async () => {
    const { client, calls } = fixture([{ data }]);
    await assert.rejects(
      startRuntimeTask({
        ...context,
        client,
      }),
      /identity/,
    );
    assert.equal(calls.length, 1);
  });
}

for (const [name, data] of Object.entries({
  wrong_task: { ...task, id: "other" },
  wrong_assignee: { ...task, assigneeId: "other" },
  conflicting_assignee: { ...task, assignee: { type: "user", id: "cow-1" } },
  wrong_organization: { ...task, organizationId: "other" },
  conflicting_workspace: { ...task, workspace: { organizationId: "other" } },
  malformed_description: { ...task, description: {} },
  absent_status: { ...task, status: undefined },
  parked: { ...task, status: "GRANT_PENDING" },
  already_running: { ...task, status: "RUNNING" },
  completed: { ...task, status: "COMPLETED" },
  canceled: { ...task, status: "CANCELED" },
})) {
  test(`runtime refuses ${name} without starting work`, async () => {
    const { client, calls } = fixture([identity, { data }]);
    await assert.rejects(
      startRuntimeTask({
        ...context,
        client,
      }),
    );
    assert.equal(calls.length, 2);
  });
}

test("runtime refuses an unwrapped response", async () => {
  const { client, calls } = fixture([identity.data]);
  await assert.rejects(
    startRuntimeTask({ ...context, client }),
    /invalid response/,
  );
  assert.equal(calls.length, 1);
});

// SPEC V19, V78: uncertain writes give recovery guidance without upstream data.
for (const operation of ["start", "complete"] as const) {
  test(`standalone ${operation} reports malformed event success as an uncertain write`, async () => {
    const { client, calls } = fixture([
      identity,
      {
        data: { ...task, status: operation === "start" ? "READY" : "RUNNING" },
      },
      { data: null, token: "coworker_private_fixture" },
    ]);
    const result =
      operation === "start"
        ? startRuntimeTask({ ...context, client })
        : completeRuntimeTask({
            ...context,
            client,
            result: "Finished answer",
          });
    await assert.rejects(result, (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /Inspect the Task before retrying/);
      assert.doesNotMatch(error.message, /coworker_private_fixture/);
      return true;
    });
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  });
}

test("an ambiguous start failure never retries and hides upstream content", async () => {
  const error = Object.assign(new Error("coworker_secret raw body"), {
    status: 500,
    body: { secret: "secret-body" },
  });
  const { client, calls } = fixture([identity, { data: task }, error]);
  await assert.rejects(
    startRuntimeTask({
      ...context,
      client,
    }),
    (failure: unknown) => {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, /HTTP 500/);
      assert.doesNotMatch(
        failure.message,
        /coworker_secret|raw body|secret-body/,
      );
      return true;
    },
  );
  assert.equal(calls.length, 3);
});

test("runtime requires a matching RUNNING event before returning Task context", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING", { taskId: "other" }),
  ]);
  await assert.rejects(
    startRuntimeTask({
      ...context,
      client,
    }),
    /could not be confirmed/,
  );
  assert.equal(calls.length, 3);
});

test("runtime executes the assigned Task once and posts its exact result", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
    { data: { ...task, status: "RUNNING" } },
    event("COMPLETED"),
  ]);
  const signal = new AbortController().signal;
  const result = "  Hello, developer!\n";
  let runs = 0;
  const outcome = await executeRuntimeTask({
    ...context,
    client,
    signal,
    execute: async (input: RuntimeTask, executionSignal?: AbortSignal) => {
      runs += 1;
      assert.equal(calls.length, 3);
      assert.deepEqual(input, {
        id: task.id,
        name: task.name,
        description: task.description,
        organizationId: task.organizationId,
        assigneeId: task.assigneeId,
        status: "RUNNING",
      });
      assert.equal(executionSignal, signal);
      return result;
    },
  });
  assert.equal(runs, 1);
  assert.deepEqual(outcome, {
    taskId: task.id,
    eventId: "event-1",
    status: "COMPLETED",
    result,
  });
  assert.deepEqual(
    calls.map(({ method, path, body }) => ({ method, path, body })),
    [
      { method: "GET", path: "/v1/coworkers/me", body: undefined },
      { method: "GET", path: "/v1/tasks/task-1", body: undefined },
      {
        method: "POST",
        path: "/v1/tasks/task-1/events",
        body: { status: "RUNNING" },
      },
      { method: "GET", path: "/v1/tasks/task-1", body: undefined },
      {
        method: "POST",
        path: "/v1/tasks/task-1/events",
        body: { status: "COMPLETED", comment: result },
      },
    ],
  );
  assert.ok(calls.every((call) => call.signal === signal));
});

test("executor failure submits no completion or failure that could overwrite cancellation", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
  ]);
  await assert.rejects(
    executeRuntimeTask({
      ...context,
      client,
      execute: async () => {
        throw new Error("raw secret execution output");
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /No completion was submitted/);
      assert.doesNotMatch(error.message, /raw secret/);
      return true;
    },
  );
  assert.equal(calls.length, 3);
});

for (const [name, changedTask] of Object.entries({
  cancellation: { ...task, status: "CANCELED" },
  reassignment: { ...task, status: "RUNNING", assigneeId: "other" },
  organization_change: { ...task, status: "RUNNING", organizationId: "other" },
})) {
  test(`runtime leaves ${name} intact after execution`, async () => {
    const { client, calls } = fixture([
      identity,
      { data: task },
      event("RUNNING"),
      { data: changedTask },
    ]);
    let runs = 0;
    await assert.rejects(
      executeRuntimeTask({
        ...context,
        client,
        execute: async () => {
          runs += 1;
          return "result";
        },
      }),
    );
    assert.equal(runs, 1);
    assert.equal(calls.length, 4);
    assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  });
}

test("abort during execution prevents completion and does not expose the abort reason", async () => {
  const controller = new AbortController();
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
  ]);
  await assert.rejects(
    executeRuntimeTask({
      ...context,
      client,
      signal: controller.signal,
      execute: async () => {
        controller.abort("coworker_secret");
        return "result";
      },
    }),
    /Runtime operation was aborted/,
  );
  assert.equal(calls.length, 3);
});

test("empty output cannot complete a Task", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
  ]);
  await assert.rejects(
    executeRuntimeTask({ ...context, client, execute: async () => " \n" }),
    /no result/,
  );
  assert.equal(calls.length, 3);
});

test("an ambiguous completion does not retry or execute again", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING"),
    { data: { ...task, status: "RUNNING" } },
    new Error("connection lost"),
  ]);
  let runs = 0;
  await assert.rejects(
    executeRuntimeTask({
      ...context,
      client,
      execute: async () => {
        runs += 1;
        return "result";
      },
    }),
    /Inspect the Task/,
  );
  assert.equal(runs, 1);
  assert.equal(calls.length, 5);
});

test("an ambiguous start failure never executes or retries and hides upstream content", async () => {
  const error = Object.assign(new Error("coworker_secret raw body"), {
    status: 500,
    body: { secret: "secret-body" },
  });
  const { client, calls } = fixture([identity, { data: task }, error]);
  await assert.rejects(
    executeRuntimeTask({
      ...context,
      client,
      execute: async () => {
        assert.fail("must not execute");
      },
    }),
    (failure: unknown) => {
      assert.ok(failure instanceof Error);
      assert.match(failure.message, /HTTP 500/);
      assert.doesNotMatch(
        failure.message,
        /coworker_secret|raw body|secret-body/,
      );
      return true;
    },
  );
  assert.equal(calls.length, 3);
});

test("runtime requires a matching RUNNING event before executing", async () => {
  const { client, calls } = fixture([
    identity,
    { data: task },
    event("RUNNING", { taskId: "other" }),
  ]);
  await assert.rejects(
    executeRuntimeTask({
      ...context,
      client,
      execute: async () => {
        assert.fail("must not execute");
      },
    }),
    /could not be confirmed/,
  );
  assert.equal(calls.length, 3);
});
