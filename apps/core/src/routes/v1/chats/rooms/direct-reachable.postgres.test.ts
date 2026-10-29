import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import {
  buildDirectParticipantRoomKey,
  createOrGetDirectRoom,
  directReachableUserWhere,
} from "./helpers";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const run = randomUUID();
const USERS = {
  reader: `reader-${run}`,
  colleagueInBothOrgs: `both-${run}`,
  colleagueInSecondOrg: `second-${run}`,
  externalGuest: `guest-${run}`,
  archivedExternalOnly: `archived-${run}`,
  publicChannelOnly: `public-${run}`,
  stranger: `stranger-${run}`,
};
type UserName = keyof typeof USERS;
const ORG1 = `org1-${run}`;
const ORG2 = `org2-${run}`;
const OTHER_ORG = `other-${run}`;

class Rollback extends Error {}

// Foreign keys and triggers are off inside the rolled-back transaction, so the
// fixture holds only the rows the rule reads.
async function withPeople(
  test: (tx: Prisma.TransactionClient) => Promise<void>,
) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        const now = new Date();
        for (const [name, id] of Object.entries(USERS)) {
          await tx.user.create({
            data: {
              id,
              name,
              email: `${id}@example.com`,
              emailVerified: true,
              createdAt: now,
              updatedAt: now,
            },
          });
        }
        for (const id of [ORG1, ORG2, OTHER_ORG]) {
          await tx.organization.create({ data: { id, name: id, slug: id } });
        }
        const member = (user: UserName, organizationId: string) =>
          tx.member.create({ data: { userId: USERS[user], organizationId } });
        await member("reader", ORG1);
        await member("reader", ORG2);
        await member("colleagueInBothOrgs", ORG1);
        await member("colleagueInBothOrgs", ORG2);
        await member("colleagueInSecondOrg", ORG2);
        await member("stranger", OTHER_ORG);
        await member("publicChannelOnly", OTHER_ORG);
        await member("externalGuest", OTHER_ORG);

        const channel = (
          discoverability: string,
          others: UserName[],
          archived = false,
        ) =>
          tx.chatRoom.create({
            data: {
              organizationId: OTHER_ORG,
              kind: "channel",
              name: `${discoverability}-${randomUUID()}`,
              slug: randomUUID(),
              discoverability,
              archivedAt: archived ? now : null,
              createdByUserId: USERS.reader,
              userMembers: {
                create: [
                  { userId: USERS.reader, access: "guest" },
                  ...others.map((user) => ({ userId: USERS[user] })),
                ],
              },
            },
          });
        await channel("external", ["externalGuest", "colleagueInBothOrgs"]);
        await channel("external", ["archivedExternalOnly"], true);
        await channel("public", ["publicChannelOnly"]);

        await test(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

describe.skipIf(!enabled)("people a reader may start a Direct with", () => {
  it("are everyone sharing an Organization or a live External channel, each once", async () => {
    await withPeople(async (tx) => {
      const people = await tx.user.findMany({
        where: {
          id: { not: USERS.reader },
          ...directReachableUserWhere(USERS.reader),
        },
        select: { name: true },
      });

      expect(people.map((person) => person.name).sort()).toEqual([
        "colleagueInBothOrgs",
        "colleagueInSecondOrg",
        "externalGuest",
      ]);
    });
  });

  it("are the Former members put back when the reader reopens a Direct", async () => {
    await withPeople(async (tx) => {
      const memberUserIds = [USERS.colleagueInSecondOrg, USERS.stranger];
      // The reader alone is left; both others were taken out earlier.
      const room = await tx.chatRoom.create({
        data: {
          organizationId: null,
          kind: "direct",
          name: "group",
          directKey: buildDirectParticipantRoomKey({
            currentUserId: USERS.reader,
            memberUserIds,
            coworkerIds: [],
          }),
          createdByUserId: USERS.reader,
          userMembers: { create: [{ userId: USERS.reader }] },
        },
      });

      const result = await createOrGetDirectRoom({
        transaction: tx,
        organizationId: null,
        currentUserId: USERS.reader,
        memberUserIds,
        coworkerIds: [],
        viewerUserId: null,
      });

      expect(result).toMatchObject({ created: false, room: { id: room.id } });
      const members = await tx.chatRoomUserMember.findMany({
        where: { roomId: room.id },
        select: { userId: true },
      });
      expect(members.map((member) => member.userId).sort()).toEqual(
        [USERS.colleagueInSecondOrg, USERS.reader].sort(),
      );
    });
  });
});
