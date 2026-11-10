import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lockTaskChatSend } from "./send-lock";

/**
 * Real-Postgres proof that a Task send holds what it checks until it
 * commits. A mocked transaction cannot show that a concurrent room
 * conversion, Task privacy change or membership removal waits for the send,
 * nor that a send waiting on such a change reads its result.
 */
const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;

const ORG = `org-${randomUUID()}`;
const USER = `user-${randomUUID()}`;
const WORKSPACE = randomUUID();
const TASK = randomUUID();
const MEMBER = randomUUID();
const ROOM = randomUUID();
const ROOM_MEMBER = randomUUID();
const input = { taskId: TASK, roomId: ROOM, userId: USER };

/** Run a write that must wait for the held send; it gives up quickly. */
async function writeWithin(sql: string, lockTimeout = "500ms") {
  if (!db) throw new Error("Missing integration database");
  await db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${lockTimeout}'`);
    await tx.$executeRawUnsafe(sql);
  });
}

/** Hold a send's locks open until `release` is called. */
function holdSend() {
  if (!db) throw new Error("Missing integration database");
  let release: () => void = () => {};
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let ready: () => void = () => {};
  const locked = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const done = db.$transaction(
    async (tx) => {
      await lockTaskChatSend(tx, input);
      ready();
      await released;
    },
    { timeout: 20_000 },
  );
  return { locked, release, done };
}

describe.skipIf(!db)("lockTaskChatSend against PostgreSQL", () => {
  beforeAll(async () => {
    if (!db) return;
    // Foreign keys are off for the fixture, so it holds only the rows the
    // lock reads. Committed, so a second connection can see them.
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = replica",
      );
      await tx.$executeRaw`INSERT INTO workspace (id, "updatedAt", "organizationId") VALUES (${WORKSPACE}::uuid, now(), ${ORG})`;
      await tx.$executeRaw`INSERT INTO member (id, "userId", "organizationId") VALUES (${MEMBER}, ${USER}, ${ORG})`;
      await tx.$executeRaw`INSERT INTO task (id, "updatedAt", "ownerId", "creatorUserId", name, status, "workspaceId", visibility) VALUES (${TASK}, now(), ${USER}, ${USER}, 'Weekly report', 'READY', ${WORKSPACE}::uuid, 'PUBLIC'::"TaskVisibility")`;
      await tx.$executeRaw`INSERT INTO chat_room (id, "organizationId", name, slug, kind, discoverability, "updatedAt", "createdByUserId") VALUES (${ROOM}::uuid, ${ORG}, 'general', ${`general-${ROOM.slice(0, 8)}`}, 'channel', 'public', now(), ${USER})`;
      await tx.$executeRaw`INSERT INTO chat_room_user_member (id, "roomId", "userId") VALUES (${ROOM_MEMBER}::uuid, ${ROOM}::uuid, ${USER})`;
    });
  });

  afterAll(async () => {
    if (!db) return;
    await db.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRawUnsafe(
        "SET LOCAL session_replication_role = replica",
      );
      await tx.$executeRaw`DELETE FROM chat_room_user_member WHERE id = ${ROOM_MEMBER}::uuid`;
      await tx.$executeRaw`DELETE FROM chat_room WHERE id = ${ROOM}::uuid`;
      await tx.$executeRaw`DELETE FROM task WHERE id = ${TASK}`;
      await tx.$executeRaw`DELETE FROM member WHERE id = ${MEMBER}`;
      await tx.$executeRaw`DELETE FROM workspace WHERE id = ${WORKSPACE}::uuid`;
    });
    await db.$disconnect();
  });

  it.each([
    [
      "opening the room to guests",
      `UPDATE chat_room SET discoverability = 'external' WHERE id = '${ROOM}'`,
    ],
    [
      "making the Task private",
      `UPDATE task SET visibility = 'PRIVATE' WHERE id = '${TASK}'`,
    ],
    [
      "moving the Task to another workspace",
      `UPDATE task SET "workspaceId" = '${randomUUID()}' WHERE id = '${TASK}'`,
    ],
    [
      "removing the sender from the organization",
      `DELETE FROM member WHERE id = '${MEMBER}'`,
    ],
    [
      "removing the sender from the room",
      `DELETE FROM chat_room_user_member WHERE id = '${ROOM_MEMBER}'`,
    ],
  ])("makes %s wait for a send in flight", async (_label, sql) => {
    const send = holdSend();
    await send.locked;
    try {
      await expect(writeWithin(sql)).rejects.toThrow(/lock timeout|55P03/);
    } finally {
      send.release();
      await send.done;
    }
  });

  it("lets two sends hold the same rows at once", async () => {
    const first = holdSend();
    await first.locked;
    try {
      await db?.$transaction(async (tx) => {
        await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '500ms'");
        await lockTaskChatSend(tx, input);
      });
    } finally {
      first.release();
      await first.done;
    }
  });

  it("makes a send wait for a room change in flight and read its result", async () => {
    if (!db) return;
    let commit: () => void = () => {};
    const committed = new Promise<void>((resolve) => {
      commit = resolve;
    });
    let changed: () => void = () => {};
    const inFlight = new Promise<void>((resolve) => {
      changed = resolve;
    });
    const change = db.$transaction(
      async (tx) => {
        await tx.$executeRaw`UPDATE chat_room SET discoverability = 'external' WHERE id = ${ROOM}::uuid`;
        changed();
        await committed;
      },
      { timeout: 20_000 },
    );
    await inFlight;

    const seen = db.$transaction(
      async (tx) => {
        await lockTaskChatSend(tx, input);
        const rows = await tx.$queryRaw<{ discoverability: string }[]>`
          SELECT discoverability FROM chat_room WHERE id = ${ROOM}::uuid
        `;
        return rows[0]?.discoverability;
      },
      { timeout: 20_000 },
    );
    // Give the send time to reach the room lock and wait on the change.
    await new Promise((resolve) => setTimeout(resolve, 300));
    commit();
    await change;

    try {
      expect(await seen).toBe("external");
    } finally {
      await db.$executeRaw`UPDATE chat_room SET discoverability = 'public' WHERE id = ${ROOM}::uuid`;
    }
  });
});
