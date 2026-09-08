import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  fetchJob,
  fetchJobEvents,
  fetchJobFiles,
  fetchJobInputRequest,
  fetchJobLinks,
  fetchJobs,
  submitJobInput,
} from "../../src/api/services/job-service.js";
import {
  addJobToTask,
  createTask,
  createTaskEvent,
  fetchTask,
  fetchTaskEvents,
  fetchTaskJobs,
  fetchTasks,
} from "../../src/api/services/task-service.js";

interface Call {
  method: string;
  path: string;
  body?: unknown;
}
function client(
  calls: Call[],
  response: unknown = { data: [] },
): CoreHttpClient {
  return {
    get: async <T>(path: string) => {
      calls.push({ method: "GET", path });
      return response as T;
    },
    post: async <T>(path: string, body: unknown) => {
      calls.push({ method: "POST", path, body });
      return response as T;
    },
    patch: async <T>(path: string, body: unknown) => {
      calls.push({ method: "PATCH", path, body });
      return response as T;
    },
    delete: async <T>(path: string) => {
      calls.push({ method: "DELETE", path });
      return response as T;
    },
  };
}

test("task services encode IDs and serialize all list filters", async () => {
  const calls: Call[] = [];
  const api = client(calls, { data: [{ id: "task-1" }] });
  await createTask(api, { name: "  Task  " });
  await fetchTask(api, "task/1");
  await fetchTasks(api, {
    q: " review ",
    status: ["READY", "DONE"],
    scope: "workspace",
    coworkerId: "cow/1",
    cursor: "next",
    take: 10,
    skip: 2,
  });
  await fetchTaskJobs(api, "task/1");
  await addJobToTask(api, "task/1", {
    agentId: "agent-1",
    inputSchema: { type: "object" },
  });
  await fetchTaskEvents(api, "task/1");
  await createTaskEvent(api, "task/1", { comment: " Done " });
  assert.deepEqual(
    calls.map(({ method, path }) => ({ method, path })),
    [
      { method: "POST", path: "/v1/tasks" },
      { method: "GET", path: "/v1/tasks/task%2F1" },
      {
        method: "GET",
        path: "/v1/tasks?q=review&scope=workspace&coworkerId=cow%2F1&cursor=next&take=10&skip=2&status=READY&status=DONE",
      },
      { method: "GET", path: "/v1/tasks/task%2F1/jobs" },
      { method: "POST", path: "/v1/tasks/task%2F1/jobs" },
      { method: "GET", path: "/v1/tasks/task%2F1/events" },
      { method: "POST", path: "/v1/tasks/task%2F1/events" },
    ],
  );
  assert.deepEqual(calls[0]?.body, { name: "Task" });
  assert.deepEqual(calls[6]?.body, { comment: "Done" });
});

test("task and job services validate IDs and required payload fields", async () => {
  const calls: Call[] = [];
  const api = client(calls);
  await assert.rejects(() => fetchTask(api, ""), /taskId is required/);
  await assert.rejects(
    () => addJobToTask(api, "task", {}),
    /agentId is required/,
  );
  await assert.rejects(
    () => addJobToTask(api, "task", { agentId: "a" }),
    /inputSchema is required/,
  );
  await assert.rejects(() => createTaskEvent(api, ""), /taskId is required/);
  await assert.rejects(() => fetchJob(api, ""), /jobId is required/);
  await assert.rejects(
    () => submitJobInput(api, "job", {}),
    /eventId is required/,
  );
  assert.equal(calls.length, 0);
});

test("job services use every current Core output route", async () => {
  const calls: Call[] = [];
  const api = client(calls, { data: [{ id: "job-1" }] });
  await fetchJobs(api);
  await fetchJob(api, "job/1");
  await fetchJobEvents(api, "job/1");
  await fetchJobFiles(api, "job/1");
  await fetchJobLinks(api, "job/1");
  await fetchJobInputRequest(api, "job/1");
  await submitJobInput(api, "job/1", {
    eventId: "event-1",
    inputData: { answer: "yes" },
  });
  assert.deepEqual(
    calls.map(({ method, path }) => ({ method, path })),
    [
      { method: "GET", path: "/v1/jobs" },
      { method: "GET", path: "/v1/jobs/job%2F1" },
      { method: "GET", path: "/v1/jobs/job%2F1/events" },
      { method: "GET", path: "/v1/jobs/job%2F1/files" },
      { method: "GET", path: "/v1/jobs/job%2F1/links" },
      { method: "GET", path: "/v1/jobs/job%2F1/input-request" },
      { method: "POST", path: "/v1/jobs/job%2F1/inputs" },
    ],
  );
  assert.deepEqual(calls[6]?.body, {
    eventId: "event-1",
    inputData: { answer: "yes" },
  });
});
