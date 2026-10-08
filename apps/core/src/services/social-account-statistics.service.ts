import { Prisma } from "@sokosumi/database";
import { fetchSocialAccountStatisticsPage } from "@/clients/social-post-providers/account-statistics";
import { isProjectSocialProvider } from "@/config/social-providers";
import { badRequest, conflict, notFound } from "@/helpers/error";
import { parseCursorPagination } from "@/helpers/pagination";
import prisma from "@/lib/db/prisma";
import { serializableTransaction } from "@/lib/db/transaction";
import {
  type SocialAccountStatistics,
  socialAccountMetricSchema,
  socialAccountPostSchema,
  socialAccountStatisticsAccountSchema,
  socialAccountStatisticsPageSchema,
  socialAccountStatisticsProviderPageSchema,
  socialAccountStatisticsSchema,
} from "@/schemas/social-account-statistics.schema";
import { listProjectSocialConnections } from "@/services/project-social-connections.service";
import { recordSocialPerformanceSnapshot } from "@/services/social-performance-snapshots.service";

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
};
const X_PRIVATE_METRIC_KEYS = new Set([
  "url_link_clicks",
  "user_profile_clicks",
  "engagements",
  "organic_impression_count",
  "organic_like_count",
  "organic_reply_count",
  "organic_repost_count",
]);

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
    return summary
      ? [
          {
            record,
            account: socialAccountStatisticsAccountSchema.parse({
              ...summary,
              statistics:
                socialAccountStatisticsSchema.safeParse(record.statistics)
                  .data ?? null,
              postCount: record._count.accountPosts,
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
  });
}

/** One provider page per request; continuations use only the server's cached cursor. */
export async function refreshSocialAccountStatistics(
  input: AccountStatisticsScope & {
    userId: string;
    connectionId: string;
    continueHistory?: boolean;
    /** Daily cron refreshes the profile and latest posts without restarting an archive cursor. */
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
  if (input.continueHistory && !previous.historyNextCursor)
    throw badRequest("Refresh the account before continuing its history");
  const attemptedAt = new Date().toISOString();
  let snapshot: SocialAccountStatistics;
  const preservePostMetrics = new Set<string>();
  const postObservationTimes = new Map<string, Date>();
  let profileMeasured = false;
  let headFetchedAt: Date | null = null;
  let paginatedHead: {
    externalIds: string[];
    nextCursor: string;
    fetchedAt: Date;
  } | null = null;
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
        signal: input.signal,
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
    const historySucceeded = page.historyError === null;
    if (!input.continueHistory && historySucceeded)
      headFetchedAt = new Date(fetchedAt);
    // Continuation progress is retained unless the transaction detects a new uncovered head gap.
    const historyProgress = historySucceeded || page.posts.length > 0;
    for (const post of page.posts)
      postObservationTimes.set(post.externalId, new Date(fetchedAt));
    if (page.metricWarning !== null)
      for (const post of page.posts) preservePostMetrics.add(post.externalId);
    let headWarning: string | null = null;
    if (input.continueHistory && input.refreshHead) {
      try {
        const head = socialAccountStatisticsProviderPageSchema.parse(
          await fetchSocialAccountStatisticsPage({
            provider: record.provider,
            connectedAccountId: record.composioConnectedAccountId,
            executorUserId: record.connectorUserId,
            externalAccountId: record.externalAccountId,
            externalHandle: record.externalHandle,
            cursor: null,
            includeProfile: false,
            signal: input.signal,
          }),
        );
        input.signal?.throwIfAborted();
        const observedAt = new Date();
        if (head.historyError === null) headFetchedAt = observedAt;
        if (head.historyError === null && head.nextCursor !== null)
          paginatedHead = {
            externalIds: head.posts.map((post) => post.externalId),
            nextCursor: head.nextCursor,
            fetchedAt: observedAt,
          };
        for (const post of head.posts)
          postObservationTimes.set(post.externalId, observedAt);
        headWarning = head.historyError ?? head.metricWarning;
        if (head.metricWarning !== null)
          for (const post of head.posts)
            preservePostMetrics.add(post.externalId);
        page.posts = [
          ...new Map(
            [...page.posts, ...head.posts].map((post) => [
              post.externalId,
              post,
            ]),
          ).values(),
        ];
      } catch {
        input.signal?.throwIfAborted();
        headWarning =
          "Latest posts could not be refreshed. Archive import progress is retained.";
      }
    }
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
      historyNextCursor: historyProgress
        ? page.nextCursor
        : previous.historyNextCursor,
      historyComplete: historySucceeded ? page.nextCursor === null : false,
      historyFetchedAt: historyProgress ? fetchedAt : previous.historyFetchedAt,
      historyError: page.historyError,
      metricWarning:
        headWarning ??
        (input.continueHistory
          ? (page.metricWarning ?? previous.metricWarning)
          : page.metricWarning),
    };
  } catch {
    input.signal?.throwIfAborted();
    snapshot = {
      ...previous,
      refreshAttemptedAt: attemptedAt,
      error: input.continueHistory
        ? previous.error
        : "Unable to refresh account statistics. Check the connection and permissions.",
      historyError:
        "Unable to load account post history. Previous cached posts are retained.",
      historyComplete: false,
    };
  }
  input.signal?.throwIfAborted();
  const result = await serializableTransaction(async (tx) => {
    const checkCompletedHeadOverlap =
      input.refreshHead &&
      !input.continueHistory &&
      previous.historyComplete &&
      snapshot.historyError === null &&
      snapshot.historyNextCursor !== null;
    const previousPosts =
      posts.length &&
      (record.provider === "x" || checkCompletedHeadOverlap || paginatedHead)
        ? await tx.socialAccountPost.findMany({
            where: {
              connectionId: record.id,
              externalId: { in: posts.map((post) => post.externalId) },
            },
            select: {
              externalId: true,
              additionalMetrics: true,
              fetchedAt: true,
            },
          })
        : [];
    const cachedIds = new Set(previousPosts.map((post) => post.externalId));
    if (
      paginatedHead &&
      !paginatedHead.externalIds.some((id) => cachedIds.has(id))
    ) {
      // The newer gap lies above the old archive cursor. Prioritize its cursor;
      // revisiting retained archive pages is safer than losing that middle range.
      snapshot.historyComplete = false;
      snapshot.historyNextCursor = paginatedHead.nextCursor;
      snapshot.historyFetchedAt = paginatedHead.fetchedAt.toISOString();
    }
    // Reaching the complete cached archive closes the new-post gap. A full page
    // containing only new identities still needs its provider continuation.
    if (checkCompletedHeadOverlap && previousPosts.length > 0) {
      snapshot.historyComplete = true;
      snapshot.historyNextCursor = null;
    }
    const statistics: Prisma.InputJsonObject = {
      ...snapshot,
      metrics: snapshot.metrics.map((metric) => ({ ...metric })),
    };
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
        performanceRefreshAttemptedAt: new Date(attemptedAt),
        ...(headFetchedAt ? { performanceHeadFetchedAt: headFetchedAt } : {}),
      },
    });
    if (updated.count === 0)
      throw conflict(
        "Account statistics changed during refresh. Reload the account.",
      );
    const fetchedAt = new Date(snapshot.historyFetchedAt ?? attemptedAt);
    for (const post of posts) {
      const previousPost =
        record.provider === "x"
          ? previousPosts.find((entry) => entry.externalId === post.externalId)
          : undefined;
      const previousMetrics =
        socialAccountMetricSchema
          .array()
          .safeParse(previousPost?.additionalMetrics).data ?? [];
      const additionalMetrics = [
        ...post.additionalMetrics,
        // Expired OAuth observations may be absent altogether from a later public-only page.
        ...previousMetrics
          .filter(
            (value) =>
              X_PRIVATE_METRIC_KEYS.has(value.key) &&
              !post.additionalMetrics.some(
                (current) => current.key === value.key,
              ),
          )
          .map((value) => ({ ...value, value: null })),
      ].map((value) => {
        if (value.value !== null || !X_PRIVATE_METRIC_KEYS.has(value.key))
          return { ...value };
        const previousValue = previousMetrics.find(
          (candidate) =>
            candidate.key === value.key && candidate.value !== null,
        );
        return previousValue && previousPost
          ? {
              ...previousValue,
              period: previousValue.period?.startsWith("lifetime:")
                ? previousValue.period
                : `lifetime:${previousPost.fetchedAt.toISOString()}`,
            }
          : { ...value };
      });
      const data = {
        text: post.text,
        contentType: post.contentType,
        postKind: post.postKind,
        media: post.media.map((item) => ({ ...item })),
        publishedAt: post.publishedAt ? new Date(post.publishedAt) : null,
        url: post.url,
        metrics: { ...post.metrics },
        additionalMetrics,
        fetchedAt: postObservationTimes.get(post.externalId) ?? fetchedAt,
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
          ? {
              text: data.text,
              publishedAt: data.publishedAt,
              url: data.url,
              contentType: data.contentType,
              postKind: data.postKind,
              media: data.media,
            }
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
        fetchedAt: new Date(),
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
