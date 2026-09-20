import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runVendorsCommand } from "../../../src/cli/commands/vendors.js";
import { runWorkspacesCommand } from "../../../src/cli/commands/workspaces.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => ({}) as T,
    patch: async <T>() => ({}) as T,
    delete: async <T>() => ({}) as T,
  };
}

test("vendors me emits one stable JSON document", async () => {
  const output: string[] = [];
  await runVendorsCommand({
    client: clientWith({
      data: [{ id: "vendor-1", name: "Acme", role: "admin" }],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "me",
  });

  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    vendors: [
      {
        id: "vendor-1",
        createdAt: null,
        updatedAt: null,
        name: "Acme",
        slug: null,
        logos: { light: null, dark: null },
        role: "admin",
      },
    ],
  });
});

test("vendors me emits stable text output", async () => {
  const output: string[] = [];
  await runVendorsCommand({
    client: clientWith({
      data: [{ id: "vendor-1", name: "Acme", slug: "acme", role: "admin" }],
    }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "me",
  });
  assert.deepEqual(output, [
    "Administered Vendors\nAcme [vendor-1]\n  slug: acme\n  role: admin\n",
  ]);
});

test("TestV79 workspaces JSON allowlists organization identity fields", async () => {
  const output: string[] = [];
  await runWorkspacesCommand({
    client: clientWith({
      data: [
        {
          id: "org-1",
          name: "Acme Organization",
          slug: "acme",
          role: "owner",
          metadata: { apiKey: "must-not-appear" },
        },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    json: true,
    subcommand: "list",
  });
  assert.equal(output.length, 1);
  assert.deepEqual(JSON.parse(output[0]!), {
    workspaces: [
      {
        organizationId: "org-1",
        createdAt: null,
        name: "Acme Organization",
        slug: "acme",
        logo: null,
        role: "owner",
      },
    ],
  });
  assert.equal(output[0]?.includes("must-not-appear"), false);
});

test("workspaces list emits stable organization workspace text output", async () => {
  const output: string[] = [];
  await runWorkspacesCommand({
    client: clientWith({
      data: [
        {
          id: "org-1",
          name: "Acme Organization",
          slug: "acme",
          role: "owner",
        },
      ],
    }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "list",
  });

  assert.equal(output.length, 1);
  assert.equal(
    output[0],
    "Organization workspaces\nAcme Organization [organization: org-1]\n  slug: acme\n  role: owner\n",
  );
});

test("workspaces list describes an empty organization workspace candidate result", async () => {
  const output: string[] = [];
  await runWorkspacesCommand({
    client: clientWith({ data: [] }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "list",
  });

  assert.deepEqual(output, ["No organization workspaces found.\n"]);
});

test("TestV80 direct discovery handlers require explicit subcommands", async () => {
  const stdout = { write: (_value: string) => {} };
  await assert.rejects(
    runVendorsCommand({ client: clientWith({ data: [] }), stdout }),
    /Usage: sokosumi vendors me/,
  );
  await assert.rejects(
    runWorkspacesCommand({ client: clientWith({ data: [] }), stdout }),
    /Usage: sokosumi workspaces list/,
  );
});
