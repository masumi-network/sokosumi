import { dispatchNotificationPublish } from "@/helpers/notification-publish";
import prisma from "@/lib/db/prisma";

const NOTIFICATION_PUBLISH_PAGE_SIZE = 100;

interface RetryNotificationPublishesOptions {
  now?: Date;
  abortSignal?: AbortSignal;
  shouldContinue?: () => boolean;
}

export async function retryNotificationPublishes({
  now,
  abortSignal,
  shouldContinue,
}: RetryNotificationPublishesOptions = {}) {
  const cutoff = now ?? new Date();
  const result = { examined: 0, published: 0, skipped: 0 };
  const canContinue = () =>
    !abortSignal?.aborted && (shouldContinue?.() ?? true);
  let cursor: string | undefined;
  while (canContinue()) {
    const rows = await prisma.notification.findMany({
      where: {
        publishId: { not: null },
        publishNextAttemptAt: { lte: cutoff },
        ...(cursor && { id: { gt: cursor } }),
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: NOTIFICATION_PUBLISH_PAGE_SIZE,
    });
    for (const row of rows) {
      if (!canContinue()) {
        return result;
      }
      const outcome = await dispatchNotificationPublish(
        row.id,
        now ?? new Date(),
      );
      result.examined += 1;
      if (outcome === "published") result.published += 1;
      if (outcome === "skipped") result.skipped += 1;
    }
    if (rows.length < NOTIFICATION_PUBLISH_PAGE_SIZE) {
      break;
    }
    cursor = rows.at(-1)?.id;
  }
  return result;
}
