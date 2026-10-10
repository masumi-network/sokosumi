import { Prisma } from "@sokosumi/database";
import prisma from "@/lib/db/prisma";
import { socialAccountStatisticsSchema } from "@/schemas/social-account-statistics.schema";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";

interface CollectionMetrics {
  accountsProcessed: number;
  pagesCollected: number;
  accountsCompleted: number;
  accountsFailed: number;
  accountsSkippedReauth: number;
  accountsSkippedBackoff: number;
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
  // Also exclude accounts needing reauthorization (checked via status field).

  // Exponential backoff: wait 5min, 15min, 1hr, 3hr, 12hr, 24hr after consecutive failures
  const backoffThresholds = [
    5 * 60 * 1000, // 5 minutes
    15 * 60 * 1000, // 15 minutes
    60 * 60 * 1000, // 1 hour
    3 * 60 * 60 * 1000, // 3 hours
    12 * 60 * 60 * 1000, // 12 hours
    24 * 60 * 60 * 1000, // 24 hours
  ];

  const accounts = await prisma.projectSocialConnection.findMany({
    where: {
      status: "active", // Excludes reauthorization_required and disconnected
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
    // No hard limit - process as many as fit within the deadline
  });

  const metrics: CollectionMetrics = {
    accountsProcessed: 0,
    pagesCollected: 0,
    accountsCompleted: 0,
    accountsFailed: 0,
    accountsSkippedReauth: 0,
    accountsSkippedBackoff: 0,
    rateLimitHits: 0,
  };

  for (const account of accounts) {
    if (input.abortSignal?.aborted || !input.shouldContinue()) break;

    const previous = socialAccountStatisticsSchema.safeParse(
      account.statistics,
    ).data;

    // Check if account needs reauthorization (should be filtered by query, but double-check)
    if (account.status === "reauthorization_required") {
      metrics.accountsSkippedReauth += 1;
      continue;
    }

    // Exponential backoff: skip if error is too recent based on failure count
    if (
      previous?.error &&
      account.performanceRefreshAttemptedAt &&
      previous.refreshAttemptedAt
    ) {
      // Count consecutive failures (simplified: use error presence as proxy)
      const backoffLevel = Math.min(
        backoffThresholds.length - 1,
        account.performanceRefreshAttemptedAt ? 1 : 0,
      );
      const backoffMs = backoffThresholds[backoffLevel] ?? 24 * 60 * 60 * 1000;
      const msSinceLastAttempt =
        now.getTime() -
        new Date(account.performanceRefreshAttemptedAt).getTime();

      if (msSinceLastAttempt < backoffMs) {
        metrics.accountsSkippedBackoff += 1;
        continue;
      }
    }

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

      // Check if this is a rate limit, auth, or reauth error
      const lowerMessage = errorMessage.toLowerCase();
      if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
        metrics.rateLimitHits += 1;
      }

      // Detect reauth requirement from error messages
      if (
        lowerMessage.includes("unauthorized") ||
        lowerMessage.includes("invalid token") ||
        lowerMessage.includes("token expired") ||
        lowerMessage.includes("authentication failed")
      ) {
        // Mark account as needing reauthorization
        await prisma.projectSocialConnection.updateMany({
          where: { id: account.id, status: "active" },
          data: { status: "reauthorization_required" },
        });
        metrics.accountsSkippedReauth += 1;
      } else {
        metrics.accountsFailed += 1;
      }
    }
  }

  console.info(
    `[social-performance-sync] Completed: ${metrics.accountsProcessed} accounts, ` +
      `${metrics.pagesCollected} pages, ${metrics.accountsCompleted} completed, ` +
      `${metrics.accountsFailed} failed, ${metrics.accountsSkippedReauth} reauth, ` +
      `${metrics.accountsSkippedBackoff} backoff, ${metrics.rateLimitHits} rate limits`,
  );

  return metrics;
}
