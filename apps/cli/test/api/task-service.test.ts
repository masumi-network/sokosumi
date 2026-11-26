import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../src/api/http-client.js";
import {
  archiveTask,
  deleteTaskLink,
} from "../../src/api/services/task-service.js";

const TASK_ID = "01a12fd2-9136-74bc-8c50-fe4bd659d4ae";

function deleteRecorder(response: unknown) {
  const calls: { path: string; body: unknown; signal: unknown }[] = [];
  const unexpected = async () => {
    throw new Error("Unexpected request");
  };
  const client: CoreHttpClient = {
    get: unexpected,
    post: unexpected,
    put: unexpected,
    patch: unexpected,
    delete: async <T>(path: string, body?: unknown, signal?: AbortSignal) => {
      calls.push({ path, body, signal });
      return response as T;
    },
  };
  return { client, calls };
}

test("archiveTask and deleteTaskLink send no body and pass the abort signal", async () => {
  const signal = new AbortController().signal;
  const { client, calls } = deleteRecorder({
    data: { id: TASK_ID, archivedAt: "2026-10-19T00:00:00.000Z" },
  });

  await archiveTask(client, TASK_ID, signal);
  await deleteTaskLink(client, TASK_ID, "tl-1", signal);

  assert.deepEqual(calls, [
    { path: `/v1/tasks/${TASK_ID}`, body: undefined, signal },
    { path: `/v1/tasks/${TASK_ID}/links/tl-1`, body: undefined, signal },
  ]);
});
