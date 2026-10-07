import type { Prisma } from "@sokosumi/database";

/** Take the row lock before sampling clocks or testing lifecycle guards. */
export async function lockBadgeCampaign(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw`SELECT "id" FROM "badge_campaign" WHERE "id" = ${id} FOR UPDATE`;
}
