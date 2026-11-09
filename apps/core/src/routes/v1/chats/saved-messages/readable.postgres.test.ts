import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  decodeSavedMessageCursor,
  encodeSavedMessageCursor,
  readableSavedMessageWhere,
  SAVED_MESSAGE_ORDER,
} from "./get";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

class Rollback extends Error {}

/** Runs `run` in a transaction that is always rolled back. */
async function rolledBack(
  run: (tx: Prisma.TransactionClient) => Promise<void>,
  { foreignKeys }: { foreignKeys: boolean },
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        if (!foreignKeys) {
          await tx.$executeRawUnsafe(
            "SET LOCAL session_replication_role = replica",
          );
        }
        await run(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function savedIds(
  tx: Prisma.TransactionClient,
  userId: string,
  organizationId: string | null,
  options: { after?: string; take?: number } = {},
) {
  const rows = await tx.chatRoomSavedMessage.findMany({
    where: readableSavedMessageWhere(
      userId,
      organizationId,
      options.after ? decodeSavedMessageCursor(options.after) : null,
    ),
    orderBy: SAVED_MESSAGE_ORDER,
    take: options.take,
    select: { id: true, savedAt: true, messageId: true },
  });
  return rows;
}

// Opt-in real Postgres proof that the Saved list shows only what the reader
// can still read, per workspace, and pages by position.
describe.skipIf(!enabled)("Saved messages against PostgreSQL", () => {
  it("shows each workspace only what the reader can still read", async () => {
    const reader = `reader-${randomUUID()}`;
    const peer = `peer-${randomUUID()}`;
    const orgA = `org-a-${randomUUID()}`;
    const orgB = `org-b-${randomUUID()}`;
    const partner = `partner-${randomUUID()}`;
    const rooms = {
      orgA: randomUUID(),
      orgALeft: randomUUID(),
      orgAArchived: randomUUID(),
      orgB: randomUUID(),
      guestExternal: randomUUID(),
      humanDirect: randomUUID(),
    };
    const messages = {
      orgA: randomUUID(),
      orgADeleted: randomUUID(),
      orgALeft: randomUUID(),
      orgAArchived: randomUUID(),
      orgB: randomUUID(),
      guestExternal: randomUUID(),
      humanDirect: randomUUID(),
    };
    const names = new Map<string, string>(
      Object.entries(messages).map(([k, v]) => [v, k]),
    );

    // Foreign keys off: the fixture holds only the rows the filter reads.
    await rolledBack(
      async (tx) => {
        const channel = async (
          id: string,
          organizationId: string,
          discoverability: string,
          members: { userId: string; access?: "member" | "guest" }[],
          archivedAt: Date | null = null,
        ) => {
          await tx.chatRoom.create({
            data: {
              id,
              organizationId,
              kind: "channel",
              name: id,
              slug: id,
              discoverability,
              archivedAt,
              createdByUserId: peer,
              userMembers: { create: members },
            },
          });
        };
        await channel(rooms.orgA, orgA, "public", [
          { userId: reader },
          { userId: peer },
        ]);
        await channel(rooms.orgALeft, orgA, "public", [{ userId: peer }]);
        await channel(
          rooms.orgAArchived,
          orgA,
          "public",
          [{ userId: reader }],
          new Date(),
        );
        await channel(rooms.orgB, orgB, "public", [{ userId: reader }]);
        await channel(rooms.guestExternal, partner, "external", [
          { userId: reader, access: "guest" },
        ]);
        await tx.chatRoom.create({
          data: {
            id: rooms.humanDirect,
            organizationId: null,
            kind: "direct",
            name: "direct",
            directKey: `direct:${rooms.humanDirect}`,
            createdByUserId: reader,
            userMembers: { create: [{ userId: reader }, { userId: peer }] },
          },
        });
        await tx.chatRoomMessage.createMany({
          data: [
            { id: messages.orgA, roomId: rooms.orgA, content: "a" },
            {
              id: messages.orgADeleted,
              roomId: rooms.orgA,
              content: "gone",
              deletedAt: new Date(),
            },
            { id: messages.orgALeft, roomId: rooms.orgALeft, content: "left" },
            {
              id: messages.orgAArchived,
              roomId: rooms.orgAArchived,
              content: "archived",
            },
            { id: messages.orgB, roomId: rooms.orgB, content: "b" },
            {
              id: messages.guestExternal,
              roomId: rooms.guestExternal,
              content: "guest",
            },
            {
              id: messages.humanDirect,
              roomId: rooms.humanDirect,
              content: "direct",
            },
          ],
        });
        await tx.chatRoomSavedMessage.createMany({
          data: [
            ...Object.values(messages).map((messageId) => ({
              userId: reader,
              messageId,
            })),
            { userId: peer, messageId: messages.orgA },
          ],
        });

        const visible = async (organizationId: string | null) =>
          (await savedIds(tx, reader, organizationId))
            .map((row) => names.get(row.messageId))
            .sort();

        expect(await visible(orgA)).toEqual([
          "guestExternal",
          "humanDirect",
          "orgA",
        ]);
        expect(await visible(orgB)).toEqual([
          "guestExternal",
          "humanDirect",
          "orgB",
        ]);
        expect(await visible(null)).toEqual(["guestExternal", "humanDirect"]);

        // Losing the membership takes the save off the list at once.
        await tx.chatRoomUserMember.deleteMany({
          where: { roomId: rooms.orgB, userId: reader },
        });
        expect(await visible(orgB)).toEqual(["guestExternal", "humanDirect"]);
      },
      { foreignKeys: false },
    );
  });

  it("keeps paging after the boundary save is removed or its message deleted", async () => {
    const reader = randomUUID();
    const peer = randomUUID();
    const room = randomUUID();
    const messageIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

    // Real foreign keys, so deleting a message cascades to its save.
    await rolledBack(
      async (tx) => {
        for (const id of [reader, peer]) {
          await tx.user.create({
            data: {
              id,
              name: "Saved messages fixture",
              email: `${id}@example.test`,
              emailVerified: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              workspace: { create: { id: randomUUID() } },
            },
          });
        }
        await tx.chatRoom.create({
          data: {
            id: room,
            organizationId: null,
            kind: "direct",
            name: "direct",
            directKey: `direct:${room}`,
            createdByUserId: reader,
            userMembers: { create: [{ userId: reader }, { userId: peer }] },
          },
        });
        await tx.chatRoomMessage.createMany({
          data: messageIds.map((id) => ({ id, roomId: room, content: id })),
        });
        await tx.chatRoomSavedMessage.createMany({
          data: messageIds.map((messageId, index) => ({
            userId: reader,
            messageId,
            savedAt: new Date(Date.UTC(2026, 10, 9, 10 - index)),
          })),
        });

        const first = await savedIds(tx, reader, null, { take: 2 });
        expect(first.map((row) => row.messageId)).toEqual(
          messageIds.slice(0, 2),
        );
        const cursor = encodeSavedMessageCursor(first[1]);

        // Removed in another tab: the cursor's own row is gone.
        await tx.chatRoomSavedMessage.delete({ where: { id: first[1].id } });
        expect(
          (await savedIds(tx, reader, null, { after: cursor })).map(
            (row) => row.messageId,
          ),
        ).toEqual(messageIds.slice(2));

        // The next message is deleted outright; its save cascades away.
        await tx.chatRoomMessage.delete({ where: { id: messageIds[2] } });
        expect(
          (await savedIds(tx, reader, null, { after: cursor })).map(
            (row) => row.messageId,
          ),
        ).toEqual([messageIds[3]]);
      },
      { foreignKeys: true },
    );
  });
});
