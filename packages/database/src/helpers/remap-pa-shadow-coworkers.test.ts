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

interface ShadowCoworkerRow {
  id: string;
  sokoBotId: string | null;
}

interface CoworkerMemberRow {
  createdAt: Date;
  coworkerId: string;
  roomId: string;
}

interface OrchestratorMemberRow {
  createdAt: Date;
  orchestratorId: string;
  roomId: string;
}

interface MessageRow {
  id: string;
  senderCoworkerId: string | null;
  senderOrchestratorId: string | null;
}

interface MentionRow {
  coworkerId: string | null;
  id: string;
  orchestratorId: string | null;
}

interface TaskRow {
  assigneeId: string | null;
  assigneeOrchestratorId: string | null;
  creatorCoworkerId: string | null;
  creatorOrchestratorId: string | null;
  id: string;
}

interface TaskEventRow {
  coworkerId: string | null;
  id: string;
  orchestratorId: string | null;
}

interface TaskFileRow {
  id: string;
  uploadedByCoworkerId: string | null;
}

interface RoomRow {
  directKey: string | null;
  id: string;
}

function matchesWhere(
  row: object,
  where: Record<string, unknown> | undefined,
): boolean {
  if (!where) return true;
  const values = row as Record<string, unknown>;
  for (const [key, expected] of Object.entries(where)) {
    const actual = values[key];
    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      "not" in expected
    ) {
      const notValue = (expected as { not: unknown }).not;
      if (notValue === null && actual == null) return false;
      if (notValue !== null && actual === notValue) return false;
      continue;
    }
    if (
      expected &&
      typeof expected === "object" &&
      !Array.isArray(expected) &&
      "in" in expected
    ) {
      const ids = (expected as { in: unknown[] }).in;
      if (!ids.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function createPaShadowRemapFixture() {
  const createdAt = new Date("2026-01-15T12:00:00.000Z");
  const coworkers: ShadowCoworkerRow[] = [
    { id: "shadow_1", sokoBotId: "bot_1" },
    { id: "marketplace_1", sokoBotId: null },
  ];
  const coworkerMembers: CoworkerMemberRow[] = [
    { roomId: "room_1", coworkerId: "shadow_1", createdAt },
    { roomId: "room_2", coworkerId: "marketplace_1", createdAt },
  ];
  const orchestratorMembers: OrchestratorMemberRow[] = [];
  const messages: MessageRow[] = [
    {
      id: "msg_1",
      senderCoworkerId: "shadow_1",
      senderOrchestratorId: null,
    },
    {
      id: "msg_market",
      senderCoworkerId: "marketplace_1",
      senderOrchestratorId: null,
    },
  ];
  const mentions: MentionRow[] = [
    { id: "mention_1", coworkerId: "shadow_1", orchestratorId: null },
    { id: "mention_market", coworkerId: "marketplace_1", orchestratorId: null },
  ];
  const tasks: TaskRow[] = [
    {
      id: "task_assigned",
      assigneeId: "shadow_1",
      assigneeOrchestratorId: null,
      creatorCoworkerId: null,
      creatorOrchestratorId: null,
    },
    {
      id: "task_created",
      assigneeId: null,
      assigneeOrchestratorId: null,
      creatorCoworkerId: "shadow_1",
      creatorOrchestratorId: null,
    },
    {
      id: "task_created_already",
      assigneeId: null,
      assigneeOrchestratorId: null,
      creatorCoworkerId: "shadow_1",
      creatorOrchestratorId: "bot_1",
    },
  ];
  const events: TaskEventRow[] = [
    { id: "event_1", coworkerId: "shadow_1", orchestratorId: null },
    { id: "event_already", coworkerId: "shadow_1", orchestratorId: "bot_1" },
  ];
  const files: TaskFileRow[] = [
    { id: "file_1", uploadedByCoworkerId: "shadow_1" },
  ];
  const rooms: RoomRow[] = [
    { id: "room_1", directKey: "coworker:user_1:shadow_1" },
    {
      id: "room_v2",
      directKey: "direct:v2:coworker:shadow_1:user:user_1",
    },
    { id: "room_other", directKey: "coworker:user_1:other" },
  ];

  function updateMany<T extends object>(
    rows: T[],
    where: Record<string, unknown> | undefined,
    data: Partial<T>,
  ) {
    let count = 0;
    for (const row of rows) {
      if (!matchesWhere(row, where)) continue;
      Object.assign(row, data);
      count += 1;
    }
    return { count };
  }

  const db = {
    coworker: {
      findMany: async (args: { where?: { sokoBotId?: { not: null } } }) => {
        if (args.where?.sokoBotId?.not === null) {
          return coworkers.filter((row) => row.sokoBotId != null);
        }
        return coworkers;
      },
      deleteMany: async (args: { where?: { id?: { in: string[] } } }) => {
        const ids = new Set(args.where?.id?.in ?? []);
        let count = 0;
        for (let index = coworkers.length - 1; index >= 0; index -= 1) {
          const coworker = coworkers[index];
          if (!coworker || !ids.has(coworker.id)) continue;
          coworkers.splice(index, 1);
          count += 1;
        }
        return { count };
      },
    },
    chatRoomCoworkerMember: {
      findMany: async (args: { where?: { coworkerId?: string } }) =>
        coworkerMembers.filter((row) => matchesWhere(row, args.where)),
      deleteMany: async (args: { where?: { coworkerId?: string } }) => {
        let count = 0;
        for (let index = coworkerMembers.length - 1; index >= 0; index -= 1) {
          const member = coworkerMembers[index];
          if (!member || !matchesWhere(member, args.where)) continue;
          coworkerMembers.splice(index, 1);
          count += 1;
        }
        return { count };
      },
    },
    chatRoomOrchestratorMember: {
      createMany: async (args: {
        data: OrchestratorMemberRow[];
        skipDuplicates?: boolean;
      }) => {
        let count = 0;
        for (const row of args.data) {
          const exists = orchestratorMembers.some(
            (member) =>
              member.roomId === row.roomId &&
              member.orchestratorId === row.orchestratorId,
          );
          if (exists && args.skipDuplicates) continue;
          orchestratorMembers.push(row);
          count += 1;
        }
        return { count };
      },
    },
    chatRoomMessage: {
      updateMany: async (args: {
        data: Partial<MessageRow>;
        where?: Record<string, unknown>;
      }) => updateMany(messages, args.where, args.data),
    },
    chatRoomMention: {
      updateMany: async (args: {
        data: Partial<MentionRow>;
        where?: Record<string, unknown>;
      }) => updateMany(mentions, args.where, args.data),
    },
    task: {
      updateMany: async (args: {
        data: Partial<TaskRow>;
        where?: Record<string, unknown>;
      }) => updateMany(tasks, args.where, args.data),
    },
    taskEvent: {
      updateMany: async (args: {
        data: Partial<TaskEventRow>;
        where?: Record<string, unknown>;
      }) => updateMany(events, args.where, args.data),
    },
    taskFile: {
      updateMany: async (args: {
        data: Partial<TaskFileRow>;
        where?: Record<string, unknown>;
      }) => updateMany(files, args.where, args.data),
    },
    chatRoom: {
      findMany: async (args: {
        where?: {
          OR?: Array<{ directKey?: { startsWith: string } }>;
        };
      }) => {
        const prefixes =
          args.where?.OR?.flatMap((clause) =>
            clause.directKey?.startsWith ? [clause.directKey.startsWith] : [],
          ) ?? [];
        return rooms.filter(
          (room) =>
            room.directKey != null &&
            prefixes.some((prefix) => room.directKey?.startsWith(prefix)),
        );
      },
      update: async (args: {
        data: { directKey: string };
        where: { id: string };
      }) => {
        const room = rooms.find((row) => row.id === args.where.id);
        if (room) room.directKey = args.data.directKey;
        return room;
      },
    },
  };

  return {
    db,
    state: {
      coworkerMembers,
      coworkers,
      events,
      files,
      mentions,
      messages,
      orchestratorMembers,
      rooms,
      tasks,
    },
  };
}

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

  it("remaps room, chat, and task identities then deletes the shadow", async () => {
    const { db, state } = createPaShadowRemapFixture();

    const result = await remapPaShadowCoworkers(db as never);

    assert.deepEqual(result, {
      shadows: 1,
      memberships: 1,
      senders: 1,
      mentions: 1,
      assignees: 1,
      creators: 2,
      events: 2,
      files: 1,
      directKeys: 2,
      deleted: 1,
    });

    assert.deepEqual(state.orchestratorMembers, [
      {
        roomId: "room_1",
        orchestratorId: "bot_1",
        createdAt: new Date("2026-01-15T12:00:00.000Z"),
      },
    ]);
    assert.equal(
      state.coworkerMembers.some((row) => row.coworkerId === "shadow_1"),
      false,
    );
    assert.equal(state.coworkerMembers[0]?.coworkerId, "marketplace_1");

    assert.deepEqual(state.messages[0], {
      id: "msg_1",
      senderCoworkerId: null,
      senderOrchestratorId: "bot_1",
    });
    assert.equal(state.messages[1]?.senderCoworkerId, "marketplace_1");

    assert.deepEqual(state.mentions[0], {
      id: "mention_1",
      coworkerId: null,
      orchestratorId: "bot_1",
    });
    assert.equal(state.mentions[1]?.coworkerId, "marketplace_1");

    assert.deepEqual(state.tasks[0], {
      id: "task_assigned",
      assigneeId: null,
      assigneeOrchestratorId: "bot_1",
      creatorCoworkerId: null,
      creatorOrchestratorId: null,
    });
    assert.deepEqual(state.tasks[1], {
      id: "task_created",
      assigneeId: null,
      assigneeOrchestratorId: null,
      creatorCoworkerId: null,
      creatorOrchestratorId: "bot_1",
    });
    assert.deepEqual(state.tasks[2], {
      id: "task_created_already",
      assigneeId: null,
      assigneeOrchestratorId: null,
      creatorCoworkerId: null,
      creatorOrchestratorId: "bot_1",
    });

    assert.deepEqual(state.events[0], {
      id: "event_1",
      coworkerId: null,
      orchestratorId: "bot_1",
    });
    assert.deepEqual(state.events[1], {
      id: "event_already",
      coworkerId: null,
      orchestratorId: "bot_1",
    });
    assert.equal(state.files[0]?.uploadedByCoworkerId, null);

    assert.equal(state.rooms[0]?.directKey, "orchestrator:user_1:bot_1");
    assert.equal(
      state.rooms[1]?.directKey,
      "direct:v2:orchestrator:bot_1:user:user_1",
    );
    assert.equal(state.rooms[2]?.directKey, "coworker:user_1:other");

    assert.deepEqual(state.coworkers, [
      { id: "marketplace_1", sokoBotId: null },
    ]);
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
