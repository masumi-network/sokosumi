import type { Prisma } from "@sokosumi/database";
import { conflict } from "@/helpers/error";

/**
 * One live campaign per Announced feature, so "seen" always names one
 * campaign. Windows are half-open: a campaign may start the instant another
 * for the same feature ends. The check and write share a Serializable
 * transaction, so concurrent creates and edits cannot bypass the check.
 */
export async function assertNoOverlappingBadgeCampaign(
  tx: Prisma.TransactionClient,
  {
    feature,
    startsAt,
    endsAt,
    excludeId,
  }: {
    feature: string;
    startsAt: Date;
    endsAt: Date;
    excludeId?: string;
  },
) {
  const overlapping = await tx.badgeCampaign.findFirst({
    where: {
      feature,
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
    select: { id: true },
  });

  if (overlapping) {
    throw conflict("Another campaign for this feature overlaps these dates");
  }
}
