/**
 * Social account sync — snapshot-as-cache.
 *
 * Public surface (3 operations):
 *   socialSyncReadModel          — derive UI freshness from stored columns
 *   requestSocialAccountRefresh  — mark dirty; never talks to providers
 *   runDueSocialAccountSync      — sole writer; cron / waitUntil
 */

import { Prisma } from "@sokosumi/database";
import { waitUntil } from "@vercel/functions";
import { err, ok, type Result } from "neverthrow";
import prisma from "@/lib/db/prisma";
import { socialAccountStatisticsSchema } from "@/schemas/social-account-statistics.schema";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";
import { refreshSocialAccountStatistics } from "@/services/social-account-statistics.service";
import {
  SOCIAL_SYNC_FRESH_MS,
  type SocialSyncReadModel,
  type SocialSyncStoredRow,
  socialSyncReadModel,
} from "@/services/social-sync-read";

export type {
  SocialSyncReadModel,
  SocialSyncStatus,
  SocialSyncStoredRow,
} from "@/services/social-sync-read";
export {
  SOCIAL_SYNC_FRESH_MS,
  SOCIAL_SYNC_LEASE_MS,
  socialSyncReadModel,
} from "@/services/social-sync-read";

const BACKOFF_MS = [
  5 * 60 * 1000,
  15 * 60 * 1000,
  60 * 60 * 1000,
  3 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
  24 * 60 * 60 * 1000,
] as const;

export type SocialSyncTrigger =
  | "cron"
  | "manual"
  | "connect"
  | "stale_auto"
  | "reauth_resume";

export type SocialSyncServiceError =
  | { code: "not_found"; connectionId: string }
  | { code: "reauth_required"; connectionId: string }
  | { code: "forbidden"; reason: string };

export interface RequestSocialAccountRefreshInput {
  projectId: string;
  workspaceId: string;
  connectionId: string;
  trigger: SocialSyncTrigger;
}

export interface RequestSocialAccountRefreshResult {
  connectionId: string;
  sync: SocialSyncReadModel;
  accepted: boolean;
}

export interface RunDueSocialAccountSyncInput {
  shouldContinue: () => boolean;
  abortSignal?: AbortSignal;
  now?: Date;
  connectionId?: string;
}

export interface RunDueSocialAccountSyncResult {
  accountsProcessed: number;
  pagesCollected: number;
  accountsCompleted: number;
  accountsFailed: number;
  accountsSkippedReauth: number;
  accountsSkippedBackoff: number;
  rateLimitHits: number;
}

function parseStoredStatistics(
  value: unknown,
): SocialSyncStoredRow["statistics"] {
  const parsed = socialAccountStatisticsSchema.safeParse(value).data;
  return parsed
    ? {
        fetchedAt: parsed.fetchedAt,
        historyFetchedAt: parsed.historyFetchedAt,
        historyError: parsed.historyError,
        metricWarning: parsed.metricWarning,
        error: parsed.error,
      }
    : null;
}

export async function requestSocialAccountRefresh(
  input: RequestSocialAccountRefreshInput,
): Promise<Result<RequestSocialAccountRefreshResult, SocialSyncServiceError>> {
  const summaries = await listProjectSocialConnections({
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  const summary = summaries.find(
    (account) => account.id === input.connectionId,
  );
  if (!summary) {
    return err({ code: "not_found", connectionId: input.connectionId });
  }
  if (summary.status !== "active") {
    return err({ code: "reauth_required", connectionId: input.connectionId });
  }
  const now = new Date();
  await prisma.projectSocialConnection.updateMany({
    where: {
      id: input.connectionId,
      projectId: input.projectId,
      project: { workspaceId: input.workspaceId },
      status: "active",
    },
    data: { performanceRefreshRequestedAt: now },
  });
  const row = await prisma.projectSocialConnection.findFirst({
    where: {
      id: input.connectionId,
      projectId: input.projectId,
      project: { workspaceId: input.workspaceId },
    },
    select: {
      status: true,
      performanceHeadFetchedAt: true,
      performanceRefreshAttemptedAt: true,
      performanceRefreshRequestedAt: true,
      statistics: true,
    },
  });
  if (!row) {
    return err({ code: "not_found", connectionId: input.connectionId });
  }
  return ok({
    connectionId: input.connectionId,
    accepted: true,
    sync: socialSyncReadModel(
      {
        status: row.status,
        performanceHeadFetchedAt: row.performanceHeadFetchedAt,
        performanceRefreshAttemptedAt: row.performanceRefreshAttemptedAt,
        performanceRefreshRequestedAt: row.performanceRefreshRequestedAt,
        statistics: parseStoredStatistics(row.statistics),
      },
      now,
    ),
  });
}

export async function runDueSocialAccountSync(
  input: RunDueSocialAccountSyncInput,
): Promise<RunDueSocialAccountSyncResult> {
  const now = input.now ?? new Date();
  const day = new Date(now);
  day.setUTCHours(0, 0, 0, 0);
  const hourAgo = new Date(now.getTime() - SOCIAL_SYNC_FRESH_MS);
  const accounts = await prisma.projectSocialConnection.findMany({
    where: {
      status: "active",
      ...(input.connectionId ? { id: input.connectionId } : {}),
      OR: [
        { performanceRefreshRequestedAt: { not: null } },
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
  });

  const metrics: RunDueSocialAccountSyncResult = {
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
    if (account.status === "reauthorization_required") {
      metrics.accountsSkippedReauth += 1;
      continue;
    }
    const previous = socialAccountStatisticsSchema.safeParse(
      account.statistics,
    ).data;
    const requestedAt = account.performanceRefreshRequestedAt ?? null;
    const attemptedAt = account.performanceRefreshAttemptedAt ?? null;
    const dirty =
      requestedAt !== null &&
      (attemptedAt === null || requestedAt.getTime() > attemptedAt.getTime());
    if (!dirty && previous?.error && account.performanceRefreshAttemptedAt) {
      const level = Math.min(
        BACKOFF_MS.length - 1,
        previous.consecutiveFailures ?? 1,
      );
      const backoffMs = BACKOFF_MS[level] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
      if (
        now.getTime() - account.performanceRefreshAttemptedAt.getTime() <
        backoffMs
      ) {
        metrics.accountsSkippedBackoff += 1;
        continue;
      }
    }

    const claimed = await prisma.projectSocialConnection.updateMany({
      where: {
        id: account.id,
        status: "active",
        performanceRefreshAttemptedAt:
          account.performanceRefreshAttemptedAt ?? null,
      },
      data: { performanceRefreshAttemptedAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      let continueHistory = Boolean(
        previous?.historyNextCursor && !previous.historyComplete,
      );
      let pagesThisAccount = 0;
      while (
        !input.abortSignal?.aborted &&
        input.shouldContinue() &&
        pagesThisAccount < 10
      ) {
        const result = await refreshSocialAccountStatistics({
          projectId: account.projectId,
          workspaceId: account.project.workspaceId,
          connectionId: account.id,
          userId: "social-performance-sync",
          signal: input.abortSignal,
          refreshHead:
            pagesThisAccount === 0 &&
            (dirty ||
              !account.performanceHeadFetchedAt ||
              account.performanceHeadFetchedAt < day),
          continueHistory,
        });
        pagesThisAccount += 1;
        metrics.pagesCollected += 1;
        const snapshot = result.account.statistics;
        if (
          !snapshot ||
          snapshot.historyComplete ||
          snapshot.historyError ||
          !snapshot.historyNextCursor
        ) {
          if (snapshot?.historyComplete) metrics.accountsCompleted += 1;
          break;
        }
        continueHistory = true;
      }
      if (
        requestedAt &&
        (!account.performanceRefreshAttemptedAt ||
          requestedAt.getTime() <= now.getTime())
      ) {
        await prisma.projectSocialConnection.updateMany({
          where: {
            id: account.id,
            performanceRefreshRequestedAt: requestedAt,
          },
          data: { performanceRefreshRequestedAt: null },
        });
      }
      metrics.accountsProcessed += 1;
    } catch (error) {
      if (input.abortSignal?.aborted) break;
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      const lowerMessage = errorMessage.toLowerCase();
      if (lowerMessage.includes("rate limit") || lowerMessage.includes("429")) {
        metrics.rateLimitHits += 1;
      }
      if (
        lowerMessage.includes("unauthorized") ||
        lowerMessage.includes("invalid token") ||
        lowerMessage.includes("token expired") ||
        lowerMessage.includes("authentication failed")
      ) {
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
  return metrics;
}

export async function scheduleSocialAccountRefresh(
  input: RequestSocialAccountRefreshInput,
): Promise<void> {
  const requested = await requestSocialAccountRefresh(input);
  if (requested.isErr()) return;
  const work = runDueSocialAccountSync({
    connectionId: input.connectionId,
    shouldContinue: () => true,
  }).then(() => undefined);
  if (process.env.VERCEL) waitUntil(work);
  else void work;
}

/** Cron alias — same writer, same metrics. */
export async function collectSocialPerformance(
  input: RunDueSocialAccountSyncInput,
): Promise<RunDueSocialAccountSyncResult> {
  return runDueSocialAccountSync(input);
}
