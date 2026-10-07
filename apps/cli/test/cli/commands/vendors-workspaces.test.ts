import assert from "node:assert/strict";
import test from "node:test";

import type { CoreHttpClient } from "../../../src/api/http-client.js";
import { runVendorsCommand } from "../../../src/cli/commands/vendors.js";
import { runWorkspacesCommand } from "../../../src/cli/commands/workspaces.js";

function clientWith(response: unknown): CoreHttpClient {
  return {
    get: async <T>() => response as T,
    post: async <T>() => ({}) as T,
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({}) as T,
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
    "Vendors\nAcme [vendor-1]\n  slug: acme\n  role: admin\n",
  ]);
});

test("vendors create posts name and slug then prints admin membership", async () => {
  let posted: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: [] }) as T,
    post: async <T>(_path: string, body: unknown) => {
      posted = body;
      return {
        data: {
          id: "vendor-new",
          name: "Acme Labs",
          slug: "acme-labs",
          role: "admin",
        },
      } as T;
    },
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
  };
  const output: string[] = [];
  await runVendorsCommand({
    client,
    stdout: { write: (value) => output.push(value) },
    subcommand: "create",
    options: { name: "Acme Labs", slug: "acme-labs" },
  });
  assert.deepEqual(posted, { name: "Acme Labs", slug: "acme-labs" });
  assert.deepEqual(output, [
    "Vendor Acme Labs [vendor-new]\nslug: acme-labs\nrole: admin\n",
  ]);
});

test("vendors me describes an empty membership result", async () => {
  const output: string[] = [];
  await runVendorsCommand({
    client: clientWith({ data: [] }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "me",
  });

  assert.deepEqual(output, ["No vendors found.\n"]);
});

test("vendors create uses the last repeated option value", async () => {
  let posted: unknown;
  const client: CoreHttpClient = {
    get: async <T>() => ({ data: [] }) as T,
    post: async <T>(_path: string, body: unknown) => {
      posted = body;
      return {
        data: {
          id: "vendor-new",
          name: "Acme Labs",
          slug: "acme-labs",
          role: "admin",
        },
      } as T;
    },
    put: async () => {
      throw new Error("Unexpected PUT");
    },
    patch: async <T>() => ({ data: {} }) as T,
  };

  await runVendorsCommand({
    client,
    stdout: { write: () => {} },
    subcommand: "create",
    options: {
      name: ["Old Name", "Acme Labs"],
      slug: ["old-name", "acme-labs"],
    },
  });

  assert.deepEqual(posted, { name: "Acme Labs", slug: "acme-labs" });
});

test("workspaces JSON allowlists organization identity fields", async () => {
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

test("workspaces check emits one JSON result without claiming runtime or credit readiness", async () => {
  for (const taskSeatEligible of [true, false]) {
    const output: string[] = [];
    const paths: string[] = [];
    const api = clientWith({});
    api.get = async <T>(path: string) => {
      paths.push(path);
      return {
        data: { assigned: taskSeatEligible, credits: 999, apiKey: "secret" },
      } as T;
    };
    api.post = api.patch = async () => {
      throw new Error("Unexpected write");
    };
    await runWorkspacesCommand({
      client: api,
      stdout: { write: (value) => output.push(value) },
      json: true,
      subcommand: "check",
      positionalId: "org-1",
    });
    assert.deepEqual(paths, ["/v1/organizations/org-1/members/me/seat"]);
    assert.equal(output.length, 1);
    assert.deepEqual(JSON.parse(output[0]!), {
      organizationId: "org-1",
      taskSeatEligible,
    });
  }
});

test("workspaces check explains missing Seat access and the owner action", async () => {
  const output: string[] = [];
  await runWorkspacesCommand({
    client: clientWith({ data: { assigned: false } }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "check",
    positionalId: "org-1",
  });
  assert.match(output.join(""), /needs an assigned Seat/);
  assert.match(output.join(""), /owner or admin to assign you a Seat/);
  assert.doesNotMatch(output.join(""), /Purchase|buy|ready to execute/);
});

test("workspaces check describes Seat policy eligibility without claiming a purchased Seat", async () => {
  const output: string[] = [];
  await runWorkspacesCommand({
    client: clientWith({ data: { assigned: true } }),
    stdout: { write: (value) => output.push(value) },
    subcommand: "check",
    positionalId: "org-1",
  });
  assert.match(output.join(""), /Seat policy allows your account/);
  assert.doesNotMatch(
    output.join(""),
    /assigned Seat|purchased Seat|ready to execute/,
  );
});

test("workspaces check validates its ID before any request", async () => {
  const api = clientWith({});
  api.get = async () => {
    throw new Error("Unexpected GET");
  };
  for (const positionalId of [undefined, "", "  "]) {
    await assert.rejects(
      runWorkspacesCommand({
        client: api,
        stdout: { write() {} },
        subcommand: "check",
        positionalId,
      }),
      /workspaces check ORGANIZATION_ID/,
    );
  }
  await assert.rejects(
    runWorkspacesCommand({
      client: api,
      stdout: { write() {} },
      subcommand: "list",
      positionalId: "org-1",
    }),
    /Usage:/,
  );
});

test("direct discovery handlers require explicit subcommands", async () => {
  const stdout = { write: (_value: string) => {} };
  await assert.rejects(
    runVendorsCommand({ client: clientWith({ data: [] }), stdout }),
    /Usage: sokosumi vendors me/,
  );
  await assert.rejects(
    runVendorsCommand({
      client: clientWith({ data: [] }),
      stdout,
      subcommand: "me",
      positionalId: "extra",
    }),
    /Usage: sokosumi vendors me/,
  );
  await assert.rejects(
    runVendorsCommand({
      client: clientWith({ data: [] }),
      stdout,
      subcommand: "create",
      positionalId: "extra",
      options: { name: "Acme", slug: "acme" },
    }),
    /Usage: sokosumi vendors me/,
  );
  await assert.rejects(
    runWorkspacesCommand({ client: clientWith({ data: [] }), stdout }),
    /Usage: sokosumi workspaces list/,
  );
});
