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
import { readNeonConfig } from "../neon-api.mjs";
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
