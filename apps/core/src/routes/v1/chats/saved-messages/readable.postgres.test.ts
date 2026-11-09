import { randomUUID } from "node:crypto";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { readableSavedMessageWhere } from "./get";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

class Rollback extends Error {}

// Opt-in real Postgres proof that the Saved list shows only what the reader
// can still read. Foreign keys are off inside the rolled-back transaction.
describe.skipIf(!enabled)("readableSavedMessageWhere (Postgres)", () => {
  it("drops deleted messages, rooms the reader left and other readers' saves", async () => {
    if (!db) throw new Error("Missing integration database");
    const reader = `reader-${randomUUID()}`;
    const other = `other-${randomUUID()}`;
    const org = `org-${randomUUID()}`;
    const memberRoom = randomUUID();
    const leftRoom = randomUUID();
    const live = randomUUID();
    const deleted = randomUUID();
    const inLeftRoom = randomUUID();

    await db
      .$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        for (const [id, members] of [
          [memberRoom, [reader, other]],
          [leftRoom, [other]],
        ] as const) {
          await tx.chatRoom.create({
            data: {
              id,
              organizationId: org,
              kind: "channel",
              name: id,
              slug: id,
              discoverability: "public",
              createdByUserId: other,
              userMembers: {
                create: members.map((userId) => ({ userId })),
              },
            },
          });
        }
        await tx.chatRoomMessage.createMany({
          data: [
            { id: live, roomId: memberRoom, content: "keep" },
            {
              id: deleted,
              roomId: memberRoom,
              content: "gone",
              deletedAt: new Date(),
            },
            { id: inLeftRoom, roomId: leftRoom, content: "left" },
          ],
        });
        await tx.chatRoomSavedMessage.createMany({
          data: [
            { userId: reader, messageId: live },
            { userId: reader, messageId: deleted },
            { userId: reader, messageId: inLeftRoom },
            { userId: other, messageId: live },
          ],
        });

        const saves = await tx.chatRoomSavedMessage.findMany({
          where: readableSavedMessageWhere(reader, org),
          select: { userId: true, messageId: true },
        });
        expect(saves).toEqual([{ userId: reader, messageId: live }]);

        const elsewhere = await tx.chatRoomSavedMessage.count({
          where: readableSavedMessageWhere(reader, `org-${randomUUID()}`),
        });
        expect(elsewhere).toBe(0);
        throw new Rollback();
      })
      .catch((error) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
