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

test("V21: coworkers register emits the Core vendorId request field", async () => {
  let requestBody: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: {} }) as T,
    post: async <T>(_path: string, body: unknown) => {
      requestBody = body;
      return {
        data: { id: "cw-1", name: "Ops Agent", capabilities: ["tasks"] },
      } as T;
    },
    patch: async <T>() => ({ data: {} }) as T,
    delete: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];

  await runCoworkersCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "register",
    options: {
      name: "Ops Agent",
      "vendor-id": "vendor-1",
      capability: "tasks",
    },
  });

  assert.deepEqual(requestBody, {
    vendorId: "vendor-1",
    name: "Ops Agent",
    capabilities: ["tasks"],
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(parsed.coworker.id, "cw-1");
  assert.equal(parsed.coworker.name, "Ops Agent");
  assert.deepEqual(parsed.coworker.capabilities, ["tasks"]);
});

test("V21: coworkers register rejects a missing vendor ID before Core request", async () => {
  let postCalled = false;
  const client = clientWith({ data: {} });
  const guardedClient: CoreHttpClient = {
    ...client,
    post: async <T>() => {
      postCalled = true;
      return { data: {} } as T;
    },
  };

  await assert.rejects(
    () =>
      runCoworkersCommand({
        client: guardedClient,
        stdout: { write() {} },
        subcommand: "register",
        options: { name: "Ops Agent" },
      }),
    /vendor id is required/,
  );
  assert.equal(postCalled, false);
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
