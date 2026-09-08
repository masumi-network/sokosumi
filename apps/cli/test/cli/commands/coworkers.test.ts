import assert from "node:assert/strict";
import test from "node:test";
import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runCoworkersCommand } from "../../../src/cli/commands/coworkers.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => response as T,
    patch: async <T>() => response as T,
    delete: async <T>() => response as T,
  };
}

test("coworkers list emits JSON and applies search/limit", async () => {
  const output: string[] = [];
  await runCoworkersCommand({
    client: clientWith({
      data: [
        { id: "cw-1", name: "Research", capabilities: ["tasks"] },
        { id: "cw-2", name: "Writer", capabilities: ["chat"] },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    options: { search: "research", limit: "1" },
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworkers.length, 1);
  assert.equal(parsed.coworkers[0].id, "cw-1");
  assert.equal(parsed.coworkers[0].name, "Research");
});

test("coworkers api-key requires an id", async () => {
  await assert.rejects(
    () =>
      runCoworkersCommand({
        client: clientWith({ data: {} }),
        stdout: { write() {} },
        subcommand: "api-key",
      }),
    /coworker id is required/,
  );
});
