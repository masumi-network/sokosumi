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
