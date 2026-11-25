import type { Prisma } from "@sokosumi/database";
import { sharedTable } from "@sokosumi/database/sql-tables";

/** Take the row lock before sampling clocks or testing lifecycle guards. */
export async function lockBadgeCampaign(
  tx: Prisma.TransactionClient,
  id: string,
) {
  await tx.$queryRaw`SELECT "id" FROM ${sharedTable("badge_campaign")} WHERE "id" = ${id} FOR UPDATE`;
}
