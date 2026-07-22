import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { upsertEnvLines } from "../apply-env.mjs";
import {
  agentBranchName,
  expiresAtIso,
  extractAgentIdsFromText,
  IDLE_TTL_MS,
  isAgentBranchName,
  isAgentRunId,
  isIdlePastTtl,
} from "../names.mjs";
import { readNeonConfig } from "../neon-api.mjs";

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

  it("computes 72h idle TTL", () => {
    const now = Date.parse("2026-07-22T12:00:00.000Z");
    assert.equal(expiresAtIso(now), "2026-07-25T12:00:00.000Z");
    assert.equal(IDLE_TTL_MS, 72 * 60 * 60 * 1000);
    assert.equal(isIdlePastTtl("2026-07-19T12:00:00.000Z", now), true);
    assert.equal(isIdlePastTtl("2026-07-20T12:00:00.000Z", now), false);
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
