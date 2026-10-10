import { Prisma } from "@sokosumi/database";
import { fetchSocialAccountStatisticsPage } from "@/clients/social-post-providers/account-statistics";
import {
  isProjectSocialProvider,
  type ProjectSocialProvider,
} from "@/config/social-providers";
import { badRequest, conflict, notFound } from "@/helpers/error";
import { parseCursorPagination } from "@/helpers/pagination";
import {
  buildSocialPerformanceHeadline,
  emptySocialPerformanceHeadline,
  type HeadlinePost,
} from "@/helpers/social-performance-headline";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type SocialAccountStatistics,
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
  socialAccountStatisticsPageSchema,
  socialAccountStatisticsProviderPageSchema,
  socialAccountStatisticsSchema,
} from "@/schemas/social-account-statistics.schema";
import { socialPostMetricsSchema } from "@/schemas/social-post-statistics.schema";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";
import { recordSocialPerformanceSnapshot } from "@/services/social-performance-snapshots.service";
import { socialSyncReadModel } from "@/services/social-sync-read";

interface AccountStatisticsScope {
  projectId: string;
  workspaceId: string;
}
interface ListSocialAccountStatisticsInput extends AccountStatisticsScope {
  provider?: string;
  connectionId?: string;
  publishedFrom?: Date;
  publishedUntil?: Date;
  cursor?: string;
  limit?: number;
}

function headlinePosts(
  rows: Array<{
    publishedAt: Date | null;
    metrics: Prisma.JsonValue;
    additionalMetrics: Prisma.JsonValue;
    connection: { provider: string };
  }>,
): HeadlinePost[] {
  return rows.flatMap((row) => {
    if (!isProjectSocialProvider(row.connection.provider)) return [];
    const metrics = socialPostMetricsSchema.safeParse(row.metrics).data;
    if (!metrics) return [];
    const additionalMetrics = Array.isArray(row.additionalMetrics)
      ? row.additionalMetrics.flatMap((metric) => {
          if (
            !metric ||
            typeof metric !== "object" ||
            !("key" in metric) ||
            typeof metric.key !== "string"
          )
            return [];
          const value =
            "value" in metric && typeof metric.value === "number"
              ? metric.value
              : null;
          return [{ key: metric.key, value }];
        })
      : [];
    return [
      {
        provider: row.connection.provider as ProjectSocialProvider,
        publishedAt: row.publishedAt,
        metrics,
        additionalMetrics,
      },
    ];
  });
}

const EMPTY_STATISTICS: SocialAccountStatistics = {
  metrics: [],
  fetchedAt: null,
  refreshAttemptedAt: null,
  error: null,
  historyNextCursor: null,
  historyComplete: false,
  historyFetchedAt: null,
  historyError: null,
  metricWarning: null,
  consecutiveFailures: 0,
};

/** Reuse the connected-account Project/workspace guard; raw credentials never leave Core. */
async function scopedConnections(input: AccountStatisticsScope) {
  const summaries = await listProjectSocialConnections(input);
  const records = await prisma.projectSocialConnection.findMany({
    where: {
      id: { in: summaries.map((account) => account.id) },
      projectId: input.projectId,
      project: { workspaceId: input.workspaceId },
      status: { not: "disconnected" },
    },
    include: { _count: { select: { accountPosts: true } } },
  });
  return records.flatMap((record) => {
    const summary = summaries.find((account) => account.id === record.id);
    const statistics =
      socialAccountStatisticsSchema.safeParse(record.statistics).data ?? null;
    return summary
      ? [
          {
            record,
            account: socialAccountStatisticsAccountSchema.parse({
              ...summary,
              statistics,
              postCount: record._count.accountPosts,
              sync: socialSyncReadModel({
                status: record.status,
                performanceHeadFetchedAt: record.performanceHeadFetchedAt,
                performanceRefreshAttemptedAt:
                  record.performanceRefreshAttemptedAt,
                performanceRefreshRequestedAt:
                  record.performanceRefreshRequestedAt,
                statistics,
              }),
            }),
          },
        ]
      : [];
  });
}

/** Cached provider history only. Account totals are independent of the post page/date range. */
export async function listSocialAccountStatistics(
  input: ListSocialAccountStatisticsInput,
) {
  const allAccounts = await scopedConnections(input);
  if (
    input.connectionId &&
    !allAccounts.some(({ account }) => account.id === input.connectionId)
  )
    throw notFound("Project social connection not found");
  const selected = allAccounts.filter(
    ({ account }) =>
      (!input.provider || account.provider === input.provider) &&
      (!input.connectionId || account.id === input.connectionId),
  );
  const where: Prisma.SocialAccountPostWhereInput = {
    connectionId: { in: selected.map(({ account }) => account.id) },
    ...(input.publishedFrom || input.publishedUntil
      ? {
          publishedAt: {
            ...(input.publishedFrom ? { gte: input.publishedFrom } : {}),
            ...(input.publishedUntil ? { lte: input.publishedUntil } : {}),
          },
        }
      : {}),
  };
  const { cursor, take, skip } = parseCursorPagination(input);
  if (
    cursor &&
    !(await prisma.socialAccountPost.findFirst({
      where: { ...where, id: cursor },
      select: { id: true },
    }))
  )
    throw badRequest(
      "Statistics cursor is outside the selected account history",
    );
  const rows = await prisma.socialAccountPost.findMany({
    where,
    include: { connection: { select: { provider: true } } },
    orderBy: [{ publishedAt: { sort: "desc", nulls: "last" } }, { id: "desc" }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip } : {}),
  });
  const cohort = selected.length
    ? await prisma.socialAccountPost.findMany({
        where,
        select: {
          publishedAt: true,
          metrics: true,
          additionalMetrics: true,
          connection: { select: { provider: true } },
        },
      })
    : [];
  const posts = rows.slice(0, take).map((row) =>
    socialAccountPostSchema.parse({
      ...row,
      provider: row.connection.provider,
    }),
  );
  return socialAccountStatisticsPageSchema.parse({
    accounts: allAccounts.map(({ account }) => account),
    posts,
    nextCursor: rows.length > take ? (posts.at(-1)?.id ?? null) : null,
    headline: selected.length
      ? buildSocialPerformanceHeadline({
          posts: headlinePosts(cohort),
          publishedFrom: input.publishedFrom,
          publishedUntil: input.publishedUntil,
        })
      : emptySocialPerformanceHeadline,
  });
}

/** One provider page per request; continuations use only the server's cached cursor. */
export async function refreshSocialAccountStatistics(
  input: AccountStatisticsScope & {
    userId: string;
    connectionId: string;
    continueHistory?: boolean;
    /** Latest page + profile without restarting an archive cursor. */
    refreshHead?: boolean;
    signal?: AbortSignal;
  },
) {
  input.signal?.throwIfAborted();
  const accounts = await scopedConnections(input);
  const target = accounts.find(
    ({ account }) => account.id === input.connectionId,
  );
  if (!target) throw notFound("Project social connection not found");
  const { record, account } = target;
  if (record.status !== "active")
    throw badRequest("Reconnect the account before refreshing statistics");
  if (!isProjectSocialProvider(record.provider))
    throw badRequest("Unsupported social account provider");
  const previous =
    socialAccountStatisticsSchema.safeParse(record.statistics).data ??
    EMPTY_STATISTICS;
  if (input.continueHistory && previous.historyComplete)
    return { account, importedPostCount: 0 };
  if (
    input.continueHistory &&
    !input.refreshHead &&
    !previous.historyNextCursor
  )
    throw badRequest("Refresh the account before continuing its history");
  const attemptedAt = new Date().toISOString();
  let snapshot: SocialAccountStatistics;
  const preservePostMetrics = new Set<string>();
  let profileMeasured = false;
  let headFetchedAt: Date | null = null;
  let posts: ReturnType<
    typeof socialAccountStatisticsProviderPageSchema.parse
  >["posts"] = [];
  try {
    const page = socialAccountStatisticsProviderPageSchema.parse(
      await fetchSocialAccountStatisticsPage({
        provider: record.provider,
        connectedAccountId: record.composioConnectedAccountId,
        executorUserId: record.connectorUserId,
        externalAccountId: record.externalAccountId,
        externalHandle: record.externalHandle,
        cursor: input.continueHistory ? previous.historyNextCursor : null,
        includeProfile: !input.continueHistory || Boolean(input.refreshHead),
        ...(input.signal ? { signal: input.signal } : {}),
      }),
    );
    input.signal?.throwIfAborted();
    const fetchedAt = new Date().toISOString();
    const measuredProfile =
      page.accountMetrics !== null &&
      page.accountMetrics.some((metric) => metric.value !== null);
    const refreshProfile =
      measuredProfile && !(page.accountError && previous.metrics.length > 0);
    profileMeasured = refreshProfile;
    for (const post of page.posts) {
      if (!Object.values(post.metrics).some((value) => value !== null))
        preservePostMetrics.add(post.externalId);
    }
    const historySucceeded = page.historyError === null;
    if ((!input.continueHistory || input.refreshHead) && historySucceeded)
      headFetchedAt = new Date(fetchedAt);
    // Verified partial rows remain useful even when the provider reports a history limit.
    const historyProgress = historySucceeded || page.posts.length > 0;
    const preserveHistory =
      Boolean(input.refreshHead) &&
      Boolean(
        previous.historyFetchedAt ||
          previous.historyNextCursor ||
          previous.historyComplete,
      );
    posts = page.posts;
    snapshot = {
      metrics: refreshProfile ? (page.accountMetrics ?? []) : previous.metrics,
      fetchedAt: refreshProfile ? fetchedAt : previous.fetchedAt,
      refreshAttemptedAt: attemptedAt,
      error:
        input.continueHistory && !input.refreshHead
          ? previous.error
          : (page.accountError ??
            (measuredProfile
              ? null
              : "No account metrics are available for this connection.")),
      historyNextCursor: preserveHistory
        ? previous.historyNextCursor
        : historyProgress
          ? page.nextCursor
          : previous.historyNextCursor,
      historyComplete: preserveHistory
        ? previous.historyComplete
        : historySucceeded
          ? page.nextCursor === null
          : false,
      historyFetchedAt: preserveHistory
        ? previous.historyFetchedAt
        : historyProgress
          ? fetchedAt
          : previous.historyFetchedAt,
      historyError: preserveHistory ? previous.historyError : page.historyError,
      metricWarning: preserveHistory
        ? (page.historyError ?? page.metricWarning ?? previous.metricWarning)
        : input.continueHistory
          ? (page.metricWarning ?? previous.metricWarning)
          : page.metricWarning,
      consecutiveFailures: 0,
    };
  } catch {
    input.signal?.throwIfAborted();
    snapshot = input.refreshHead
      ? {
          ...previous,
          refreshAttemptedAt: attemptedAt,
          consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
          metricWarning:
            "Latest posts could not be refreshed. Archive import progress is retained.",
        }
      : {
          ...previous,
          refreshAttemptedAt: attemptedAt,
          consecutiveFailures: (previous.consecutiveFailures ?? 0) + 1,
          error: input.continueHistory
            ? previous.error
            : "Unable to refresh account statistics. Check the connection and permissions.",
          historyError:
            "Unable to load account post history. Previous cached posts are retained.",
          historyComplete: false,
        };
  }
  const statistics: Prisma.InputJsonObject = {
    ...snapshot,
    metrics: snapshot.metrics.map((metric) => ({ ...metric })),
  };
  const result = await serializableTransaction(async (tx) => {
    const updated = await tx.projectSocialConnection.updateMany({
      where: {
        id: record.id,
        projectId: input.projectId,
        project: { workspaceId: input.workspaceId },
        status: "active",
        composioConnectedAccountId: record.composioConnectedAccountId,
        externalAccountId: record.externalAccountId,
        connectorUserId: record.connectorUserId,
        statistics: { equals: record.statistics ?? Prisma.DbNull },
      },
      data: {
        statistics,
        ...(headFetchedAt ? { performanceHeadFetchedAt: headFetchedAt } : {}),
      },
    });
    if (updated.count === 0)
      throw conflict(
        "Account statistics changed during refresh. Reload the account.",
      );
    const fetchedAt = new Date(snapshot.historyFetchedAt ?? attemptedAt);
    for (const post of posts) {
      const data = {
        text: post.text,
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        url: post.url,
        metrics: { ...post.metrics },
        additionalMetrics: post.additionalMetrics.map((metric) => ({
          ...metric,
        })),
        fetchedAt,
      };
      await tx.socialAccountPost.upsert({
        where: {
          connectionId_externalId: {
            connectionId: record.id,
            externalId: post.externalId,
          },
        },
        create: {
          ...data,
          connectionId: record.id,
          externalId: post.externalId,
        },
        // Partial insights must not erase measured counters or their original age.
        update: preservePostMetrics.has(post.externalId)
          ? { text: data.text, publishedAt: data.publishedAt, url: data.url }
          : data,
      });
    }
    if (
      profileMeasured ||
      posts.some((post) => !preservePostMetrics.has(post.externalId))
    ) {
      await recordSocialPerformanceSnapshot(tx, {
        connectionId: record.id,
        metrics: profileMeasured
          ? snapshot.metrics.map((metric) => ({ ...metric }))
          : null,
        profileFetchedAt:
          profileMeasured && snapshot.fetchedAt
            ? new Date(snapshot.fetchedAt)
            : null,
        fetchedAt: new Date(snapshot.historyFetchedAt ?? attemptedAt),
      });
    }
    const postCount = await tx.socialAccountPost.count({
      where: { connectionId: record.id },
    });
    return {
      account: { ...account, statistics: snapshot, postCount },
      importedPostCount: new Set(posts.map((post) => post.externalId)).size,
    };
  }, "Account statistics changed during refresh. Reload the account.");
  return result;
}
