import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { upsertEnvLines } from "../apply-env.mjs";
import { checkAgentFixtureSafety } from "../assert-agent-database.mjs";
import { AUTH_FIXTURES, FIXTURE_PASSWORD } from "../fixtures.mjs";
import {
  agentBranchName,
  expiresAtIso,
  extractAgentIdsFromText,
  IDLE_TTL_MS,
  isAgentBranchName,
  isAgentRunId,
} from "../names.mjs";
import {
  findBranchByName,
  readNeonConfig,
  resetPreviewBranchToParent,
  resolveParentBranch,
  waitForOperations,
} from "../neon-api.mjs";
import {
  clearUnwantedOrganizationMemberships,
  resetUnwantedPersonalWorkspace,
  throwIfZeroWorkspaceResetFailed,
} from "../seed-auth-fixtures.mjs";

describe("names", () => {
  it("builds agent branch names with stable prefix", () => {
    const id = "bc-bc5212fe-8ee2-4bfa-9e8d-85e27cb47e48";
    assert.equal(agentBranchName(id), `cloud-agent-${id}`);
    assert.equal(isAgentBranchName(agentBranchName(id)), true);
    assert.equal(isAgentBranchName("main"), false);
    assert.equal(isAgentBranchName("production"), false);
    assert.equal(isAgentBranchName("preview/pr-1"), false);
  });

  it("validates agent run ids", () => {
    assert.equal(isAgentRunId("bc-bc5212fe-8ee2-4bfa-9e8d-85e27cb47e48"), true);
    assert.equal(isAgentRunId("main"), false);
    assert.equal(isAgentRunId(""), false);
  });

  it("extracts agent ids from PR bodies and cursor links", () => {
    const text = `
Linear Issue: SOK-651
https://cursor.com/agents/bc-0c091101-a060-4ad6-856c-c903c59dde1b
also bc-bc5212fe-8ee2-4bfa-9e8d-85e27cb47e48 and again
bc-0c091101-a060-4ad6-856c-c903c59dde1b
`;
    assert.deepEqual(extractAgentIdsFromText(text), [
      "bc-0c091101-a060-4ad6-856c-c903c59dde1b",
      "bc-bc5212fe-8ee2-4bfa-9e8d-85e27cb47e48",
    ]);
    assert.deepEqual(extractAgentIdsFromText(""), []);
  });

  it("computes 72h Neon expires_at timestamps", () => {
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    assert.equal(expiresAtIso(now), "2026-07-25T12:00:00.000Z");
    assert.equal(IDLE_TTL_MS, 72 * 60 * 60 * 1000);
  });
});

describe("readNeonConfig", () => {
  it("returns null when secrets missing", () => {
    assert.equal(readNeonConfig({}), null);
    assert.equal(readNeonConfig({ NEON_API_KEY: "k" }), null);
  });

  it("defaults parent branch to main", () => {
    assert.deepEqual(
      readNeonConfig({
        NEON_API_KEY: "k",
        NEON_PROJECT_ID: "proj",
      }),
      {
        apiKey: "k",
        projectId: "proj",
        parentBranchName: "main",
        databaseName: "neondb",
        roleName: "neondb_owner",
      },
    );
  });
});

describe("upsertEnvLines", () => {
  it("replaces existing DATABASE_URL and adds unpooled", () => {
    const input = "FOO=1\nDATABASE_URL=old\nBAR=2\n";
    const out = upsertEnvLines(input, {
      DATABASE_URL: "new",
      DATABASE_URL_UNPOOLED: "new-direct",
    });
    assert.match(out, /^DATABASE_URL=new$/m);
    assert.match(out, /^DATABASE_URL_UNPOOLED=new-direct$/m);
    assert.match(out, /^FOO=1$/m);
    assert.doesNotMatch(out, /old/);
  });
});

describe("checkAgentFixtureSafety", () => {
  const agentBranch = "cloud-agent-bc-bc5212fe-8ee2-4bfa-9e8d-85e27cb47e48";
  const url = "postgresql://u:p@ep-agent.us-east-1.aws.neon.tech/neondb";

  it("allows agent branch + database url", () => {
    assert.deepEqual(
      checkAgentFixtureSafety({
        branchName: agentBranch,
        databaseUrl: url,
      }),
      { ok: true },
    );
  });

  it("blocks production/main branch names", () => {
    const result = checkAgentFixtureSafety({
      branchName: "main",
      databaseUrl: url,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /non-agent branch/);
  });

  it("blocks missing branch without force", () => {
    const result = checkAgentFixtureSafety({
      branchName: null,
      databaseUrl: url,
    });
    assert.equal(result.ok, false);
  });

  it("blocks force without agent branch on remote hosts", () => {
    const result = checkAgentFixtureSafety({
      branchName: null,
      databaseUrl: url,
      force: true,
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /cloud-agent-\*|localhost/);
  });

  it("allows force on localhost for dry-runs", () => {
    assert.deepEqual(
      checkAgentFixtureSafety({
        branchName: null,
        databaseUrl: "postgresql://sokosumi:sokosumi@localhost:5432/core",
        force: true,
      }),
      { ok: true },
    );
  });
});

describe("auth fixtures", () => {
  it("exposes known emails and password for agents", () => {
    assert.equal(FIXTURE_PASSWORD.length >= 8, true);
    assert.equal(AUTH_FIXTURES.length >= 1, true);
    for (const fixture of AUTH_FIXTURES) {
      assert.match(fixture.email, /@sokosumi\.test$/);
    }
  });

  it("includes one platform admin", () => {
    const admins = AUTH_FIXTURES.filter((fixture) => fixture.role === "admin");
    assert.equal(admins.length, 1);
    assert.equal(admins[0]?.email, "admin@sokosumi.test");
  });

  it("includes a zero-workspace fixture without org or personal workspace", () => {
    const zero = AUTH_FIXTURES.find(
      (fixture) => fixture.email === "zero@sokosumi.test",
    );
    assert.ok(zero, "missing zero@sokosumi.test fixture");
    assert.equal(zero.name, "Zero Workspace");
    assert.equal(zero.role, "user");
    assert.equal(zero.organization ?? null, null);
    assert.equal(zero.createPersonalWorkspace, false);
  });

  it("gives org-enabled fixtures unique organization slugs", () => {
    const slugs = new Set();
    for (const fixture of AUTH_FIXTURES) {
      if (fixture.organization == null) {
        continue;
      }
      assert.match(fixture.organization.slug, /^[a-z0-9-]+$/);
      assert.ok(fixture.organization.name.length >= 1);
      assert.equal(
        slugs.has(fixture.organization.slug),
        false,
        `duplicate org slug: ${fixture.organization.slug}`,
      );
      slugs.add(fixture.organization.slug);
    }
    assert.ok(slugs.size >= 1, "expected at least one org-enabled fixture");
  });
});

describe("resetUnwantedPersonalWorkspace", () => {
  it("deletes the personal workspace inside a savepoint", async () => {
    const queries = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        return { rowCount: 1 };
      },
    };

    const result = await resetUnwantedPersonalWorkspace(client, {
      userId: "user-zero",
      email: "zero@sokosumi.test",
    });

    assert.equal(result.reset, true);
    assert.equal(queries[0], "SAVEPOINT zero_workspace_reset");
    assert.match(queries[1], /DELETE FROM workspace/);
    assert.equal(queries[2], "RELEASE SAVEPOINT zero_workspace_reset");
  });

  it("rolls back only the savepoint when delete hits an FK", async () => {
    const queries = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        if (String(sql).includes("DELETE FROM workspace")) {
          throw new Error(
            'update or delete on table "workspace" violates foreign key constraint',
          );
        }
        return { rowCount: 0 };
      },
    };

    const result = await resetUnwantedPersonalWorkspace(client, {
      userId: "user-zero",
      email: "zero@sokosumi.test",
    });

    assert.equal(result.reset, false);
    assert.equal(queries[0], "SAVEPOINT zero_workspace_reset");
    assert.match(queries[1], /DELETE FROM workspace/);
    assert.equal(queries[2], "ROLLBACK TO SAVEPOINT zero_workspace_reset");
    assert.equal(
      queries.includes("ROLLBACK"),
      false,
      "must not roll back the outer fixture transaction",
    );
  });
});

describe("throwIfZeroWorkspaceResetFailed", () => {
  it("does nothing when every reset succeeded", () => {
    throwIfZeroWorkspaceResetFailed([]);
  });

  it("throws after other fixtures would have committed", () => {
    assert.throws(
      () => throwIfZeroWorkspaceResetFailed(["zero@sokosumi.test"]),
      /Auth fixtures committed, but personal workspace reset failed/,
    );
  });
});

describe("clearUnwantedOrganizationMemberships", () => {
  it("deletes memberships and clears selected-organization state", async () => {
    const queries = [];
    const client = {
      async query(sql) {
        queries.push(sql);
        return { rowCount: 0 };
      },
    };

    await clearUnwantedOrganizationMemberships(client, { userId: "user-zero" });

    assert.match(queries[0], /DELETE FROM member/);
    assert.match(queries[1], /preferredOrganizationId/);
    assert.match(queries[2], /activeOrganizationId/);
  });
});

/**
 * Neon config whose fetch answers from a queue of [status, body] pairs. An
 * Error in the queue is thrown, as fetch does on a network failure. An empty
 * queue answers 404, which no caller retries.
 */
function queuedNeon(responses) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({
      url: String(url),
      method: init.method ?? "GET",
      body: init.body,
    });
    const next = responses.shift() ?? [404, { message: "no queued reply" }];
    if (next instanceof Error) {
      throw next;
    }
    const [status, body] = next;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: String(status),
      text: async () => JSON.stringify(body),
    };
  };
  return { config: { apiKey: "k", projectId: "proj", fetchImpl }, calls };
}

const PREVIEW_BRANCH = {
  id: "br-preview",
  name: "preview/feat/x",
  parent_id: "br-main",
  default: false,
  protected: false,
};
const NO_WAIT = { sleep: async () => {} };

describe("findBranchByName", () => {
  it("searches by name and returns only the exact match", async () => {
    const { config, calls } = queuedNeon([
      [200, { branches: [{ name: "preview/feat/x-2" }, PREVIEW_BRANCH] }],
    ]);
    assert.deepEqual(
      await findBranchByName(config, "preview/feat/x"),
      PREVIEW_BRANCH,
    );
    assert.equal(
      calls[0].url,
      "https://console.neon.tech/api/v2/projects/proj/branches?limit=10000&search=preview%2Ffeat%2Fx",
    );
  });
});

describe("resolveParentBranch", () => {
  it("lists every branch without a search", async () => {
    const main = { id: "br-main", name: "main", default: true };
    const { config, calls } = queuedNeon([[200, { branches: [main] }]]);
    assert.deepEqual(await resolveParentBranch(config, () => false), main);
    assert.equal(
      calls[0].url,
      "https://console.neon.tech/api/v2/projects/proj/branches?limit=10000",
    );
  });
});

describe("resetPreviewBranchToParent", () => {
  it("restores the branch from its parent", async () => {
    const operations = [{ id: "op-1", status: "running" }];
    const { config, calls } = queuedNeon([[200, { operations }]]);
    assert.deepEqual(
      await resetPreviewBranchToParent(config, PREVIEW_BRANCH, NO_WAIT),
      { operations },
    );
    assert.equal(calls[0].method, "POST");
    assert.equal(
      calls[0].url,
      "https://console.neon.tech/api/v2/projects/proj/branches/br-preview/restore",
    );
    assert.deepEqual(JSON.parse(calls[0].body), {
      source_branch_id: "br-main",
    });
  });

  it("refuses non-preview, protected, default, and parentless branches", async () => {
    const { config, calls } = queuedNeon([]);
    for (const [branch, pattern] of [
      [{ ...PREVIEW_BRANCH, name: "main" }, /non-preview branch "main"/],
      [{ ...PREVIEW_BRANCH, name: "cloud-agent-bc-1" }, /non-preview/],
      [{ ...PREVIEW_BRANCH, protected: true }, /protected\/default/],
      [{ ...PREVIEW_BRANCH, default: true }, /protected\/default/],
      [{ ...PREVIEW_BRANCH, parent_id: undefined }, /no parent/],
    ]) {
      await assert.rejects(
        () => resetPreviewBranchToParent(config, branch, NO_WAIT),
        pattern,
      );
    }
    assert.deepEqual(calls, []);
  });

  it("retries 423 Locked with doubling delays", async () => {
    const delays = [];
    const { config, calls } = queuedNeon([
      ...Array.from({ length: 4 }, () => [423, { message: "locked" }]),
      [200, { operations: [] }],
    ]);
    await resetPreviewBranchToParent(config, PREVIEW_BRANCH, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    assert.equal(calls.length, 5);
    assert.deepEqual(delays, [100, 200, 400, 800]);
  });

  it("gives up after five attempts and never retries other errors", async () => {
    const locked = queuedNeon(
      Array.from({ length: 6 }, () => [423, { message: "locked" }]),
    );
    await assert.rejects(
      () => resetPreviewBranchToParent(locked.config, PREVIEW_BRANCH, NO_WAIT),
      /failed \(423\): locked/,
    );
    assert.equal(locked.calls.length, 5);

    const conflict = queuedNeon([[409, { message: "has children" }]]);
    await assert.rejects(
      () =>
        resetPreviewBranchToParent(conflict.config, PREVIEW_BRANCH, NO_WAIT),
      /failed \(409\): has children/,
    );
    assert.equal(conflict.calls.length, 1);
  });
});

describe("waitForOperations", () => {
  it("polls each operation until it finishes or is skipped", async () => {
    const { config, calls } = queuedNeon([
      [200, { operation: { id: "op-1", status: "running" } }],
      [200, { operation: { id: "op-1", status: "finished" } }],
      [200, { operation: { id: "op-2", status: "skipped" } }],
    ]);
    await waitForOperations(
      config,
      [
        { id: "op-1", status: "scheduling" },
        { id: "op-2", status: "running" },
      ],
      NO_WAIT,
    );
    assert.deepEqual(
      calls.map((call) => call.url.split("/api/v2")[1]),
      [
        "/projects/proj/operations/op-1",
        "/projects/proj/operations/op-1",
        "/projects/proj/operations/op-2",
      ],
    );
  });

  it("does not poll an operation that already finished", async () => {
    const { config, calls } = queuedNeon([]);
    await waitForOperations(
      config,
      [{ id: "op-1", status: "finished" }],
      NO_WAIT,
    );
    assert.deepEqual(calls, []);
  });

  it("throws when an operation ends failed, error, or cancelled", async () => {
    for (const status of ["failed", "error", "cancelled"]) {
      const { config } = queuedNeon([
        [200, { operation: { id: "op-1", status } }],
      ]);
      await assert.rejects(
        () =>
          waitForOperations(
            config,
            [{ id: "op-1", status: "running" }],
            NO_WAIT,
          ),
        new RegExp(`op-1 ended ${status}$`),
      );
    }
  });

  it("polls again after a network error, a rate limit, or a server error", async () => {
    const { config, calls } = queuedNeon([
      new TypeError("fetch failed"),
      [429, { message: "slow down" }],
      [500, { message: "internal" }],
      [503, { message: "unavailable" }],
      [200, { operation: { id: "op-1", status: "finished" } }],
    ]);
    await waitForOperations(
      config,
      [{ id: "op-1", status: "running" }],
      NO_WAIT,
    );
    assert.equal(calls.length, 5);
  });

  it("stops at once on a client error", async () => {
    const { config, calls } = queuedNeon([
      [401, { message: "bad key" }],
      [200, { operation: { id: "op-1", status: "finished" } }],
    ]);
    await assert.rejects(
      () =>
        waitForOperations(config, [{ id: "op-1", status: "running" }], NO_WAIT),
      /failed \(401\): bad key/,
    );
    assert.equal(calls.length, 1);
  });

  it("throws when the deadline passes first", async () => {
    let clock = 0;
    const { config } = queuedNeon(
      Array.from({ length: 3 }, () => [
        200,
        { operation: { id: "op-1", status: "running" } },
      ]),
    );
    await assert.rejects(
      () =>
        waitForOperations(config, [{ id: "op-1", status: "running" }], {
          sleep: async (ms) => {
            clock += ms;
          },
          now: () => clock,
          intervalMs: 5,
          timeoutMs: 10,
        }),
      /op-1 did not finish \(last status: running\)/,
    );
  });

  it("gives all operations one shared deadline", async () => {
    let clock = 0;
    const running = [200, { operation: { id: "op-2", status: "running" } }];
    const { config } = queuedNeon([
      [200, { operation: { id: "op-1", status: "finished" } }],
      running,
      running,
      running,
    ]);
    await assert.rejects(
      () =>
        waitForOperations(
          config,
          [
            { id: "op-1", status: "running" },
            { id: "op-2", status: "running" },
          ],
          {
            sleep: async (ms) => {
              clock += ms;
            },
            now: () => clock,
            intervalMs: 5,
            timeoutMs: 10,
          },
        ),
      /op-2 did not finish/,
    );
    assert.equal(clock, 10);
  });

  it("polls a later operation once before the deadline fails it", async () => {
    let clock = 0;
    const { config, calls } = queuedNeon([
      [200, { operation: { id: "op-1", status: "running" } }],
      [200, { operation: { id: "op-1", status: "finished" } }],
      [200, { operation: { id: "op-2", status: "finished" } }],
    ]);
    await waitForOperations(
      config,
      [
        { id: "op-1", status: "running" },
        { id: "op-2", status: "running" },
      ],
      {
        sleep: async (ms) => {
          clock += ms;
        },
        now: () => clock,
        intervalMs: 5,
        timeoutMs: 10,
      },
    );
    assert.deepEqual(
      calls.map((call) => call.url.split("/operations/")[1]),
      ["op-1", "op-1", "op-2"],
    );
  });

  it("waits 5 minutes by default", async () => {
    let clock = 0;
    const { config } = queuedNeon(
      Array.from({ length: 60 }, () => [
        200,
        { operation: { id: "op-1", status: "running" } },
      ]),
    );
    await assert.rejects(
      () =>
        waitForOperations(config, [{ id: "op-1", status: "running" }], {
          sleep: async (ms) => {
            clock += ms;
          },
          now: () => clock,
        }),
      /op-1 did not finish \(last status: running\)/,
    );
    assert.equal(clock, 5 * 60 * 1000);
  });

  it("names the last poll's failure when the deadline passes", async () => {
    const running = [200, { operation: { id: "op-1", status: "running" } }];
    for (const [replies, last] of [
      [
        [running, new TypeError("fetch failed")],
        "last poll failed: fetch failed",
      ],
      [[new TypeError("fetch failed"), running], "last status: running"],
    ]) {
      let clock = 0;
      const { config } = queuedNeon(replies);
      await assert.rejects(
        () =>
          waitForOperations(config, [{ id: "op-1", status: "running" }], {
            sleep: async (ms) => {
              clock += ms;
            },
            now: () => clock,
            intervalMs: 5,
            timeoutMs: 10,
          }),
        { message: `Neon operation op-1 did not finish (${last})` },
      );
    }
  });
});
