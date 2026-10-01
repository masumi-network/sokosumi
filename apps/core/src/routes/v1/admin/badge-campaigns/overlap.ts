import { conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";

/**
 * One live campaign per Announced feature, so "seen" always names one
 * campaign. Windows are half-open: a campaign may start the instant another
 * for the same feature ends. Admin edits are rare enough that last write wins
 * if two admins race.
 */
export async function assertNoOverlappingBadgeCampaign({
  feature,
  startsAt,
  endsAt,
  excludeId,
}: {
  feature: string;
  startsAt: Date;
  endsAt: Date;
  excludeId?: string;
}) {
  const overlapping = await prisma.badgeCampaign.findFirst({
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
