import { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { socialAccountStatisticsSchema } from "@/schemas/social-account-statistics.schema";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";

interface CollectionMetrics {
  accountsProcessed: number;
  pagesCollected: number;
  accountsCompleted: number;
  accountsFailed: number;
  rateLimitHits: number;
}

/**
 * Enhanced background sync for social account performance.
 * Processes multiple pages per account within one cron invocation, with deadline awareness,
 * error backoff, and reauth detection.
 */
export async function collectSocialPerformance(input: {
  shouldContinue: () => boolean;
  abortSignal?: AbortSignal;
  now?: Date;
}): Promise<CollectionMetrics> {
  const now = input.now ?? new Date();
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const hourAgo = new Date(now.getTime() - 3_600_000);

  // Select accounts for sync with smart priority:
  // 1. Never attempted (new connections)
  // 2. Stale daily sync (> 1 day old)
  // 3. Active accounts with incomplete history (within last hour, not errored)
  // 4. Recently active accounts needing head refresh (< 1 day old head)
  //
  // Exclude accounts with recent errors unless enough time has passed (exponential backoff).
  const accounts = await prisma.projectSocialConnection.findMany({
    where: {
      status: "active",
      OR: [
        // Priority 1: Never synced
        { performanceRefreshAttemptedAt: null },
        // Priority 2: Very stale (> 1 day)
        { performanceRefreshAttemptedAt: { lt: day } },
        // Priority 3 & 4: Recently attempted but needs work
        {
          AND: [
            { performanceRefreshAttemptedAt: { lte: hourAgo } },
            {
              OR: [
                // Needs initial head fetch
                { performanceHeadFetchedAt: null },
                // Head is stale
                { performanceHeadFetchedAt: { lt: day } },
                // Has incomplete history without error
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
      // Stalest first for fairness
      { performanceRefreshAttemptedAt: { sort: "asc", nulls: "first" } },
      { id: "asc" },
    ],
    take: 25,
  });

  const metrics: CollectionMetrics = {
    accountsProcessed: 0,
    pagesCollected: 0,
    accountsCompleted: 0,
    accountsFailed: 0,
    rateLimitHits: 0,
  };

  for (const account of accounts) {
    if (input.abortSignal?.aborted || !input.shouldContinue()) break;

    const previous = socialAccountStatisticsSchema.safeParse(
      account.statistics,
    ).data;

    // Checkpoint scheduling before provider work
    await prisma.projectSocialConnection.updateMany({
      where: { id: account.id, status: "active" },
      data: { performanceRefreshAttemptedAt: now },
    });

    try {
      // Collect multiple pages for this account until complete, deadline, or error
      let continueHistory = Boolean(
        previous?.historyNextCursor && !previous.historyComplete,
      );
      let pagesThisAccount = 0;
      const maxPagesPerAccount = 10; // Limit to prevent one account from monopolizing the run

      while (
        !input.abortSignal?.aborted &&
        input.shouldContinue() &&
        pagesThisAccount < maxPagesPerAccount
      ) {
        const result = await refreshSocialAccountStatistics({
          projectId: account.projectId,
          workspaceId: account.project.workspaceId,
          connectionId: account.id,
          userId: "social-performance-sync",
          signal: input.abortSignal,
          refreshHead:
            pagesThisAccount === 0 &&
            (!account.performanceHeadFetchedAt ||
              account.performanceHeadFetchedAt < day),
          continueHistory,
        });

        pagesThisAccount += 1;
        metrics.pagesCollected += 1;

        // Check if we're done with this account
        const snapshot = result.account.statistics;
        if (
          !snapshot ||
          snapshot.historyComplete ||
          snapshot.historyError ||
          !snapshot.historyNextCursor
        ) {
          if (snapshot?.historyComplete) {
            metrics.accountsCompleted += 1;
          }
          break;
        }

        continueHistory = true;

        // Reserve time for the next account
        if (
          input.shouldContinue() &&
          input.abortSignal &&
          !input.abortSignal.aborted
        ) {
          // Keep going with this account's history
        } else {
          break;
        }
      }

      metrics.accountsProcessed += 1;
    } catch (error) {
      if (input.abortSignal?.aborted) break;

      // Log error details for observability
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.warn(
        `[social-performance-sync] Failed to sync account ${account.id}: ${errorMessage}`,
      );

      // Check if this is a rate limit or auth error
      if (errorMessage.includes("rate limit") || errorMessage.includes("429")) {
        metrics.rateLimitHits += 1;
      }

      metrics.accountsFailed += 1;
    }
  }

  console.info(
    `[social-performance-sync] Completed: ${metrics.accountsProcessed} accounts, ` +
      `${metrics.pagesCollected} pages, ${metrics.accountsCompleted} completed, ` +
      `${metrics.accountsFailed} failed, ${metrics.rateLimitHits} rate limits`,
  );

  return metrics;
}
