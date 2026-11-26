import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { AuthManager } from "../../src/auth/auth-manager.js";
import { type CliDependencies, runCli } from "../../src/cli/index.js";

const API = ["--api-url", "https://fixture.invalid"];

const OPENAPI = {
  paths: {
    "/organizations/{id}/standup": {
      put: {
        requestBody: {
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Standup" },
            },
          },
        },
      },
    },
    "/users/{id}/workspaces": {
      post: {
        requestBody: {
          content: {
            "application/json": {
              schema: {
                oneOf: [
                  {
                    type: "object",
                    required: ["kind"],
                    properties: {
                      kind: { type: "string", enum: ["personal"] },
                    },
                  },
                  {
                    allOf: [
                      {
                        type: "object",
                        required: ["kind"],
                        properties: {
                          kind: { type: "string", enum: ["organization"] },
                        },
                      },
                      {
                        allOf: [
                          {
                            type: "object",
                            required: ["websiteUrl"],
                            properties: { websiteUrl: { type: "string" } },
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    },
    "/agents/{id}/reviews": {
      get: {
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
          {
            name: "limit",
            in: "query",
            description: "Page size.",
            schema: { type: "integer" },
          },
        ],
      },
    },
  },
  components: {
    schemas: {
      Standup: {
        type: "object",
        required: ["enabled", "localTime"],
        properties: {
          enabled: { type: "boolean" },
          localTime: {
            type: "string",
            description: "Local time as HH:MM.",
          },
          days: {
            type: "array",
            items: { type: "string", enum: ["MON", "TUE"] },
          },
          refs: {
            type: "array",
            items: {
              type: "object",
              required: ["kind"],
              properties: {
                kind: { type: "string" },
                id: { anyOf: [{ type: "string" }, { type: "null" }] },
              },
            },
          },
        },
      },
    },
  },
};

function fixture(t: TestContext, respond: () => Response) {
  const output: string[] = [];
  const urls: string[] = [];
  const deps: CliDependencies = {
    env: {},
    authManager: new AuthManager({
      credentialStore: { read: () => null, write() {}, clear() {} },
      apiKeyStore: { read: () => null, write() {}, clear() {} },
    }),
    stdout: { write: (value) => output.push(value) },
  };
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    urls.push(String(input));
    return respond();
  });
  return { deps, output, urls };
}

test("<command> --help prints the body fields from Core's OpenAPI document (SOKD-474)", async (t) => {
  const f = fixture(t, () => Response.json(OPENAPI));
  await runCli([...API, "organizations", "set-standup", "--help"], f.deps);
  assert.deepEqual(f.urls, ["https://fixture.invalid/v1/openapi.json"]);
  assert.equal(
    f.output.join(""),
    `Usage: sokosumi organizations set-standup ORGANIZATION_ID --input-json JSON
Core operation: PUT /organizations/{id}/standup

Body (--input-json or --input-file):
  enabled  boolean, required
  localTime  string, required. Local time as HH:MM.
  days  array of "MON"|"TUE"
  refs  array of object
    kind  string, required
    id  string|null
`,
  );
});

test("<command> --help lists query parameters and says when there is no body", async (t) => {
  const f = fixture(t, () => Response.json(OPENAPI));
  await runCli([...API, "agents", "reviews", "--help"], f.deps);
  assert.match(
    f.output.join(""),
    /Query \(--query KEY=VALUE\):\n {2}limit {2}integer\. Page size\.\n/,
  );
  assert.match(f.output.join(""), /No body\./);
});

test("<command> --help still prints usage when Core can't be read", async (t) => {
  const f = fixture(t, () => new Response("down", { status: 503 }));
  await runCli([...API, "organizations", "set-standup", "--help"], f.deps);
  assert.match(
    f.output.join(""),
    /^Usage: sokosumi organizations set-standup .*\nCore operation: PUT \/organizations\/\{id\}\/standup\n\nCould not read the body fields from https:\/\/fixture\.invalid\/v1\/openapi\.json: status 503\n$/,
  );
});

test("a bespoke command's --help prints its usage without calling Core", async (t) => {
  const f = fixture(t, () => Response.json(OPENAPI));
  await runCli([...API, "tasks", "get", "--help"], f.deps);
  assert.deepEqual(f.urls, []);
  assert.equal(
    f.output.join(""),
    "Usage: sokosumi tasks get TASK_ID [--organization-slug WORKSPACE_SLUG]\nRun sokosumi --help for the options it takes.\n",
  );
});

test("an unknown subcommand says so and lists the group's commands (SOKD-474)", async (t) => {
  const f = fixture(t, () => Response.json({}));
  await assert.rejects(
    runCli(
      ["organizations", "approve-coworker-access", "org-1", "id-1", "--json"],
      f.deps,
    ),
    (error: Error) => {
      assert.match(
        error.message,
        /^Unknown command: sokosumi organizations approve-coworker-access\. organizations commands: .*deny-coworker-access/,
      );
      return true;
    },
  );
  assert.deepEqual(f.urls, []);
  assert.match(JSON.parse(f.output.join("")).error, /^Unknown command/);
});

test("<command> --help prints each shape of a body that takes one of several", async (t) => {
  const f = fixture(t, () => Response.json(OPENAPI));
  await runCli([...API, "workspaces", "create", "--help"], f.deps);
  assert.match(
    f.output.join(""),
    /Body \(--input-json or --input-file\):\n {2}kind {2}"personal", required\n {2}or\n {2}kind {2}"organization", required\n {2}websiteUrl {2}string, required\n$/,
  );
});

test("an unknown subcommand wins over option errors such as --query", async (t) => {
  const f = fixture(t, () => Response.json({}));
  await assert.rejects(
    runCli(["organizations", "bogus", "org-1", "--query", "x=1"], f.deps),
    /Unknown command: sokosumi organizations bogus\./,
  );
});

test("<command> --help stops on a union that refers back to itself", async (t) => {
  const loop = { $ref: "#/components/schemas/Loop" };
  const doc = {
    paths: {
      "/organizations/{id}/standup": {
        put: {
          requestBody: { content: { "application/json": { schema: loop } } },
        },
      },
    },
    components: {
      schemas: {
        Loop: {
          oneOf: [
            loop,
            { type: "object", properties: { a: { type: "string" } } },
          ],
          allOf: [loop],
        },
      },
    },
  };
  const f = fixture(t, () => Response.json(doc));
  await runCli([...API, "organizations", "set-standup", "--help"], f.deps);
  assert.match(f.output.join(""), /a {2}string/);
});
