import prisma from "@/lib/db/prisma";
import {
  WARMUP_LOOKBACK_DAYS,
  warmupPauseReason,
  warmupRates,
} from "@/lib/newsletter/sending-domain-warmup";

/** Assess only real attempts attributed to this verified custom domain. */
export async function pauseNewsletterSendingDomainIfUnhealthy(
  sendingDomainId: string,
  now = new Date(),
): Promise<void> {
  const domain = await prisma.newsletterSendingDomain.findUnique({
    where: { id: sendingDomainId },
  });
  if (
    domain?.status !== "VERIFIED" ||
    !domain.warmupStartedAt ||
    domain.warmupPausedAt
  ) {
    return;
  }
  const since = new Date(
    Math.max(
      domain.warmupStartedAt.getTime(),
      now.getTime() - WARMUP_LOOKBACK_DAYS * 86_400_000,
    ),
  );
  const where = { sendingDomainId, attemptedAt: { gte: since, lte: now } };
  const [attempted, hardBounced, complained] = await Promise.all([
    prisma.newsletterSend.count({ where }),
    prisma.newsletterSend.count({
      where: {
        ...where,
        events: {
          some: {
            type: "BOUNCED",
            bounceType: { in: ["permanent", "hard"] },
            occurredAt: { gte: since, lte: now },
          },
        },
      },
    }),
    prisma.newsletterSend.count({
      where: {
        ...where,
        events: {
          some: {
            type: "COMPLAINED",
            occurredAt: { gte: since, lte: now },
          },
        },
      },
    }),
  ]);
  const reason = warmupPauseReason(
    warmupRates({ attempted, hardBounced, complained }),
  );
  if (!reason) return;
  await prisma.newsletterSendingDomain.updateMany({
    where: {
      id: domain.id,
      status: "VERIFIED",
      warmupStartedAt: domain.warmupStartedAt,
      warmupPausedAt: null,
    },
    data: { warmupPausedAt: now, warmupPauseReason: reason },
  });
}
