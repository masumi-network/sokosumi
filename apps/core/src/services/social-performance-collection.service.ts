import { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { socialAccountStatisticsSchema } from "@/schemas/social-account-statistics.schema";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";

/** One resumable provider page per due account. The shared cron harness owns auth, deadline and lock. */
export async function collectSocialPerformance(input: {
  shouldContinue: () => boolean;
  abortSignal?: AbortSignal;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const accounts = await prisma.projectSocialConnection.findMany({
    where: {
      status: "active",
      OR: [
        { performanceRefreshAttemptedAt: null },
        { performanceRefreshAttemptedAt: { lt: day } },
        {
          AND: [
            { performanceRefreshAttemptedAt: { lte: hourAgo } },
            {
              OR: [
                { performanceHeadFetchedAt: null },
                { performanceHeadFetchedAt: { lt: day } },
                {
                  AND: [
                    {
                      statistics: { path: ["historyComplete"], equals: false },
                    },
                    {
                      statistics: {
                        path: ["historyError"],
                        equals: Prisma.JsonNull,
                      },
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
    include: { project: { select: { workspaceId: true } } },
    orderBy: [
      { performanceRefreshAttemptedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    take: 25,
  });
  let refreshed = 0;
  let failed = 0;
  for (const account of accounts) {
    if (input.abortSignal?.aborted || !input.shouldContinue()) break;
    const previous = socialAccountStatisticsSchema.safeParse(
      account.statistics,
    ).data;
    // Checkpoint scheduling before provider work: a deadline must not keep the same slow account first.
    await prisma.projectSocialConnection.updateMany({
      where: { id: account.id, status: "active" },
      data: { performanceRefreshAttemptedAt: now },
    });
    try {
      await refreshSocialAccountStatistics({
        projectId: account.projectId,
        workspaceId: account.project.workspaceId,
        connectionId: account.id,
        userId: "social-performance-sync",
        signal: input.abortSignal,
        refreshHead:
          !account.performanceHeadFetchedAt ||
          account.performanceHeadFetchedAt < day,
        continueHistory: Boolean(
          previous?.historyNextCursor && !previous.historyComplete,
        ),
      });
      refreshed += 1;
    } catch {
      if (input.abortSignal?.aborted) break;
      // A revoked/disconnected account or concurrent manual refresh must not starve later accounts.
      failed += 1;
    }
  }
  return { refreshed, failed };
}
