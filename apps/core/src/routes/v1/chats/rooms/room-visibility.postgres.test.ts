import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { createPrismaClient } from "@sokosumi/database/client";
import { afterAll, describe, expect, it } from "vitest";

import { membershipVisibleActiveRoomWhere } from "./helpers";

const url = process.env.DATABASE_URL;
const enabled =
  process.env.RUN_DATABASE_INTEGRATION_TESTS === "true" &&
  url?.startsWith("postgres");
const db = enabled && url ? createPrismaClient(url) : null;
afterAll(async () => {
  await db?.$disconnect();
});

const READER = `reader-${randomUUID()}`;
const PEER = `peer-${randomUUID()}`;
const ORG1 = `org1-${randomUUID()}`;
const ORG2 = `org2-${randomUUID()}`;
const PARTNER_ORG = `partner-${randomUUID()}`;
const COWORKER = `coworker-${randomUUID()}`;
const SOKO_BOT = randomUUID();

const ROOMS = {
  hostedExternal: randomUUID(),
  guestExternal: randomUUID(),
  publicChannel: randomUUID(),
  privateChannel: randomUUID(),
  otherOrgChannel: randomUUID(),
  matched: randomUUID(),
  personalHumanDirect: randomUUID(),
  personalCoworkerDirect: randomUUID(),
  personalSokoBotDirect: randomUUID(),
  orgCoworkerDirect: randomUUID(),
  orgSokoBotDirect: randomUUID(),
};
type RoomName = keyof typeof ROOMS;

class Rollback extends Error {}

// Opt-in real Postgres proof of the sidebar room rule. Foreign keys and
// triggers are off inside the rolled-back transaction, so the fixture holds
// only the rows the filter reads.
async function withRooms(run: (tx: Prisma.TransactionClient) => Promise<void>) {
  if (!db) throw new Error("Missing integration database");
  await db
    .$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(
          "SET LOCAL session_replication_role = replica",
        );
        const channel = async (
          name: RoomName,
          organizationId: string | null,
          discoverability: string,
          access: "member" | "guest" = "member",
        ) => {
          await tx.chatRoom.create({
            data: {
              id: ROOMS[name],
              organizationId,
              kind: "channel",
              name,
              slug: name.toLowerCase(),
              discoverability,
              createdByUserId: READER,
              userMembers: { create: { userId: READER, access } },
            },
          });
        };
        const direct = async (
          name: RoomName,
          organizationId: string | null,
          ai: { coworker?: boolean; sokoBot?: boolean } = {},
        ) => {
          await tx.chatRoom.create({
            data: {
              id: ROOMS[name],
              organizationId,
              kind: "direct",
              name,
              directKey: `${name}:${ROOMS[name]}`,
              createdByUserId: READER,
              userMembers: {
                create: [
                  { userId: READER },
                  ...(ai.coworker || ai.sokoBot ? [] : [{ userId: PEER }]),
                ],
              },
              ...(ai.coworker
                ? { coworkerMembers: { create: { coworkerId: COWORKER } } }
                : {}),
              ...(ai.sokoBot
                ? { sokoBotMembers: { create: { sokoBotId: SOKO_BOT } } }
                : {}),
            },
          });
        };

        await channel("hostedExternal", ORG1, "external");
        await channel("guestExternal", PARTNER_ORG, "external", "guest");
        await channel("publicChannel", ORG1, "public");
        await channel("privateChannel", ORG1, "private");
        await channel("otherOrgChannel", ORG2, "public");
        await channel("matched", null, "matched");
        await direct("personalHumanDirect", null);
        await direct("personalCoworkerDirect", null, { coworker: true });
        await direct("personalSokoBotDirect", null, { sokoBot: true });
        await direct("orgCoworkerDirect", ORG1, { coworker: true });
        await direct("orgSokoBotDirect", ORG1, { sokoBot: true });

        await run(tx);
        throw new Rollback();
      },
      { timeout: 20000 },
    )
    .catch((error: unknown) => {
      if (!(error instanceof Rollback)) throw error;
    });
}

async function sidebarRooms(
  tx: Prisma.TransactionClient,
  organizationId: string | null,
) {
  const rows = await tx.chatRoom.findMany({
    where: {
      userMembers: { some: { userId: READER } },
      ...membershipVisibleActiveRoomWhere(organizationId),
    },
    select: { id: true },
  });
  const names = new Map<string, string>(
    Object.entries(ROOMS).map(([name, id]) => [id, name]),
  );
  return rows.map((row) => names.get(row.id)).sort();
}

describe.skipIf(!enabled)("sidebar room visibility against PostgreSQL", () => {
  it("shows the personal workspace its own AI Directs plus the rooms shown everywhere", async () => {
    await withRooms(async (tx) => {
      expect(await sidebarRooms(tx, null)).toEqual([
        "guestExternal",
        "hostedExternal",
        "matched",
        "personalCoworkerDirect",
        "personalHumanDirect",
        "personalSokoBotDirect",
      ]);
    });
  });

  it("shows the host Organization its Channels and AI Directs plus the rooms shown everywhere", async () => {
    await withRooms(async (tx) => {
      expect(await sidebarRooms(tx, ORG1)).toEqual([
        "guestExternal",
        "hostedExternal",
        "matched",
        "orgCoworkerDirect",
        "orgSokoBotDirect",
        "personalHumanDirect",
        "privateChannel",
        "publicChannel",
      ]);
    });
  });

  it("shows another Organization the hosted External channel but no personal AI Direct", async () => {
    await withRooms(async (tx) => {
      expect(await sidebarRooms(tx, ORG2)).toEqual([
        "guestExternal",
        "hostedExternal",
        "matched",
        "otherOrgChannel",
        "personalHumanDirect",
      ]);
    });
  });
});
