import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it } from "vitest";

import {
  remapPaShadowCoworkers,
  remapPaShadowDirectKey,
} from "./remap-pa-shadow-coworkers.js";

const MIGRATION_SQL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../prisma/migrations/20260902140000_pa_orchestrator_chat_task_cutover/migration.sql",
);

describe("remapPaShadowDirectKey", () => {
  it("rewrites coworker 1:1 keys onto the orchestrator", () => {
    assert.equal(
      remapPaShadowDirectKey("coworker:user_1:shadow_1", "shadow_1", "bot_1"),
      "orchestrator:user_1:bot_1",
    );
  });

  it("rewrites direct:v2 coworker tokens", () => {
    assert.equal(
      remapPaShadowDirectKey(
        "direct:v2:coworker:shadow_1:user:user_1",
        "shadow_1",
        "bot_1",
      ),
      "direct:v2:orchestrator:bot_1:user:user_1",
    );
  });

  it("leaves unrelated keys unchanged", () => {
    assert.equal(
      remapPaShadowDirectKey("coworker:user_1:other", "shadow_1", "bot_1"),
      "coworker:user_1:other",
    );
    assert.equal(
      remapPaShadowDirectKey("user_1:user_2", "shadow_1", "bot_1"),
      "user_1:user_2",
    );
  });
});

describe("remapPaShadowCoworkers", () => {
  it("is a no-op when no shadow coworkers exist", async () => {
    const db = {
      coworker: {
        findMany: async () => [],
      },
    };
    const result = await remapPaShadowCoworkers(db as never);
    assert.deepEqual(result, {
      shadows: 0,
      memberships: 0,
      senders: 0,
      mentions: 0,
      assignees: 0,
      creators: 0,
      events: 0,
      files: 0,
      directKeys: 0,
      deleted: 0,
    });
  });
});

describe("PA orchestrator cutover migration", () => {
  const sql = readFileSync(MIGRATION_SQL_PATH, "utf8");

  it("adds orchestrator chat/task FKs, remaps shadows, then deletes them", () => {
    assert.match(sql, /CREATE TABLE "chat_room_orchestrator_member"/);
    assert.match(sql, /ADD COLUMN "senderOrchestratorId"/);
    assert.match(sql, /ADD COLUMN "assigneeOrchestratorId"/);
    assert.match(sql, /ALTER COLUMN "coworkerId" DROP NOT NULL/);
    assert.match(sql, /SET\s+"senderOrchestratorId" = c\."sokoBotId"/);
    assert.match(sql, /SET\s+"assigneeOrchestratorId" = c\."sokoBotId"/);
    assert.match(sql, /DELETE FROM "coworker"\s+WHERE "sokoBotId" IS NOT NULL/);
    assert.match(sql, /chat_room_mention_target_xor_check/);
    assert.match(sql, /task_assignee_xor_check/);
    assert.match(sql, /senderOrchestratorId/);
  });

  it("refuses to finish while shadow rows remain", () => {
    assert.match(sql, /still have sokoBotId after PA shadow delete/);
  });
});
