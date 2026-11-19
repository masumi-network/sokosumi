/**
 * One-off, approved by the owner (Patrick, 2026-11-19): clears what the first
 * competitor check of his own Cuso ("CMO.xyz · cmo.xyz") left behind before
 * the rules for the week's message changed (#7562, #7565).
 *
 * 1. Tombstones the five chat messages Core posted one per move
 *    (`cmo:competitor-move:*`), the way Core's own message delete does:
 *    `deletedAt`, empty content, no metadata.
 * 2. Deletes that check's feed (seven items, two of them the same Hootsuite
 *    price told twice). The stored signals stay; the next weekly check writes
 *    a feed under the new rules.
 *
 * It names every row by id, reads each first, and stops without writing when
 * one is not what this note says. Without `--apply` it only reports.
 *
 *   pnpm --filter @sokosumi/database data-migration:cmo-clear-first-competitor-week
 *   pnpm --filter @sokosumi/database data-migration:cmo-clear-first-competitor-week -- --apply
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

import { createPrismaClient, PrismaRaw } from "../src/client.js";

loadEnv({
  path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env"),
});

const PROJECT_ID = "01a1f18d-e437-700f-81bc-79bdb4488638";
const SOKO_BOT_ID = "01a1f18d-e46b-712d-abb1-dd1bff316d7c";
const ROOM_ID = "01a1f18d-e476-7239-83ed-d603341a19db";
const MESSAGE_IDS = [
  "01a1f1a5-1d6c-7166-aab8-0ba57b8c8423",
  "01a1f1a5-1d7a-73f8-ac84-83ae4b54e609",
  "01a1f1a5-1d8a-777c-9c6e-6edc88d8f141",
  "01a1f1a5-1d96-7744-9889-7ad5a733b8cf",
  "01a1f1a5-1da3-7647-8073-b05278d69528",
];
const MOVE_MESSAGE_PREFIX = "cmo:competitor-move:";
const FEED_ID = "01a1f1a5-1d53-73e1-9c6e-4d634cf14632";
const FEED_CHECK_DAY = "2026-11-19";

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL_UNPOOLED?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_URL is required (packages/database/.env, same as prisma migrate)",
    );
  }
  const apply = process.argv.includes("--apply");
  const prisma = createPrismaClient(databaseUrl);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const messages = await tx.chatRoomMessage.findMany({
        where: { id: { in: MESSAGE_IDS } },
        select: {
          id: true,
          roomId: true,
          senderSokoBotId: true,
          clientMessageId: true,
          deletedAt: true,
          createdAt: true,
          content: true,
        },
        orderBy: { createdAt: "asc" },
      });
      for (const message of messages) {
        console.log(
          `message ${message.id} ${message.createdAt.toISOString()} ${message.clientMessageId} deleted=${message.deletedAt !== null} "${message.content.replace(/\s+/g, " ").slice(0, 60)}"`,
        );
      }
      const wrong = messages.filter(
        (message) =>
          message.roomId !== ROOM_ID ||
          message.senderSokoBotId !== SOKO_BOT_ID ||
          !message.clientMessageId?.startsWith(MOVE_MESSAGE_PREFIX),
      );
      if (messages.length !== MESSAGE_IDS.length || wrong.length > 0) {
        throw new Error(
          `Expected ${MESSAGE_IDS.length} competitor-move messages of this Cuso; found ${messages.length}, ${wrong.length} not his. Nothing was changed.`,
        );
      }
      // Any other message of that kind in the room would be news to us.
      const others = await tx.chatRoomMessage.count({
        where: {
          roomId: ROOM_ID,
          clientMessageId: { startsWith: MOVE_MESSAGE_PREFIX },
          id: { notIn: MESSAGE_IDS },
        },
      });
      if (others > 0) {
        throw new Error(
          `The room holds ${others} more competitor-move messages than the five approved. Nothing was changed.`,
        );
      }

      const feed = await tx.competitorFeed.findUnique({
        where: { id: FEED_ID },
        select: { id: true, projectId: true, checkDay: true, items: true },
      });
      const items = Array.isArray(feed?.items) ? feed.items.length : 0;
      console.log(
        feed
          ? `feed ${feed.id} checkDay=${feed.checkDay} items=${items}`
          : `feed ${FEED_ID} is already gone`,
      );
      if (
        feed &&
        (feed.projectId !== PROJECT_ID || feed.checkDay !== FEED_CHECK_DAY)
      ) {
        throw new Error(
          "The feed is not the first check's feed of this Project. Nothing was changed.",
        );
      }

      if (!apply) return { tombstoned: 0, feedDeleted: 0 };
      const tombstoned = await tx.chatRoomMessage.updateMany({
        where: { id: { in: MESSAGE_IDS }, roomId: ROOM_ID, deletedAt: null },
        data: {
          deletedAt: new Date(),
          content: "",
          metadata: PrismaRaw.DbNull,
        },
      });
      const feedDeleted = await tx.competitorFeed.deleteMany({
        where: {
          id: FEED_ID,
          projectId: PROJECT_ID,
          checkDay: FEED_CHECK_DAY,
        },
      });
      return { tombstoned: tombstoned.count, feedDeleted: feedDeleted.count };
    });
    console.log(
      apply
        ? `Done: messages tombstoned=${result.tombstoned}, feeds deleted=${result.feedDeleted}`
        : "Dry run: nothing was changed. Pass --apply to write.",
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
