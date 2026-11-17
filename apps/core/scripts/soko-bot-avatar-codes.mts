/**
 * Give every Soko Bot without an avatar code one. A bot with a claimed pool
 * picture gets the closest look nobody holds; the rest get a random free one.
 * Dry run by default.
 *
 * pnpm --filter @sokosumi/core soko-bot:avatar-codes
 * pnpm --filter @sokosumi/core soko-bot:avatar-codes -- --apply
 */
import prisma from "@/lib/db/prisma";
import {
  planAvatarCodes,
  setSokoBotAvatarCode,
} from "@/services/soko-bot-avatar-code.service";

const apply = process.argv.includes("--apply");
const CONCURRENCY = 4;

const bots = await prisma.sokoBot.findMany({
  where: { deletedAt: null, avatarCode: null },
  select: {
    id: true,
    avatarImageUrl: true,
    avatar: { select: { subject: true, background: true } },
  },
  orderBy: { createdAt: "asc" },
});
const held = new Set(
  (
    await prisma.sokoBot.findMany({
      where: { avatarCode: { not: null } },
      select: { avatarCode: true },
    })
  ).map((bot) => bot.avatarCode as string),
);
const plan = planAvatarCodes(
  bots.map((bot) => ({ id: bot.id, ...bot.avatar })),
  held,
);

const queue = bots.map((bot) => ({ bot, code: plan.get(bot.id) as string }));
let failed = 0;
async function worker() {
  for (let next = queue.shift(); next; next = queue.shift()) {
    const { bot, code } = next;
    console.log(`${bot.id}  ${bot.avatarImageUrl ?? "(none)"} → ${code}`);
    if (!apply) continue;
    await setSokoBotAvatarCode(bot.id, code).catch((error) => {
      failed += 1;
      console.error(`${bot.id}  failed`, error);
    });
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
console.log(
  `${bots.length} bots${apply ? `, ${failed} failed` : " (dry run, pass --apply to write)"}`,
);
await prisma.$disconnect();
