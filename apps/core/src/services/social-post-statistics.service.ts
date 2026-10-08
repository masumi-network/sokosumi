import { Prisma } from "@sokosumi/database";
import { PrismaRaw } from "@sokosumi/database/client";
import { SOCIAL_POST_TEXT_LIMITS } from "@sokosumi/utils";
import { z } from "zod";
import {
  fetchSocialPostStatistics,
  SocialPostStatisticsUnavailableError,
} from "@/clients/social-post-providers/statistics";
import { badRequest, conflict } from "@/helpers/error";
import prisma from "@/lib/db/prisma";
import {
  type SocialPostMetrics,
  type SocialPostStatistics,
  socialPostMetricsSchema,
  socialPostStatisticsSummarySchema,
} from "@/schemas/social-post-statistics.schema";
import {
  getSocialPost,
  type ListSocialPostsInput,
  listSocialPosts,
  type SocialPostSummary,
} from "@/services/social-posts.service";

// Match dateTimeSchema: valid UTC ISO timestamps, including optional precision.
const CACHE_TIMESTAMP_PATTERN = z.regexes.datetime({}).source;

const EMPTY_METRICS: SocialPostMetrics = {
  views: null,
  impressions: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
};

export interface SocialPostStatisticsSummary {
  provider: string;
  postCount: number;
  measuredPostCount: number;
  metrics: SocialPostMetrics;
}

/** Sums only reported lifetime counters; null means no measurement, not zero. */
export async function listSocialPostStatistics(
  input: Omit<ListSocialPostsInput, "statuses">,
): Promise<{
  posts: SocialPostSummary[];
  summary: SocialPostStatisticsSummary[];
  nextCursor: string | null;
}> {
  // Reuse the Project/workspace authorization and pagination seam before aggregation.
  const page = await listSocialPosts({ ...input, statuses: ["PUBLISHED"] });
  const rows = await prisma.$queryRaw(PrismaRaw.sql`
    WITH snapshots AS (
      -- Reject whole malformed snapshots just as mapSocialPost's Zod schema does.
      SELECT provider, CASE WHEN
        jsonb_typeof(statistics) = 'object'
        AND statistics ?& ARRAY['metrics', 'fetchedAt', 'refreshAttemptedAt', 'error']
        AND jsonb_typeof(statistics->'error') IN ('string', 'null')
        AND statistics->>'fetchedAt' IS NOT NULL
        AND (SELECT bool_and(stamp IS NULL OR stamp ~ ${CACHE_TIMESTAMP_PATTERN})
          FROM (VALUES (statistics->>'fetchedAt'), (statistics->>'refreshAttemptedAt')) AS stamps(stamp))
        AND jsonb_typeof(statistics->'metrics') = 'object'
        AND statistics->'metrics' ?& ARRAY['views', 'impressions', 'likes', 'comments', 'shares', 'saves']
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(statistics->'metrics') = 'object'
            THEN statistics->'metrics' ELSE '{}'::jsonb END)
          WHERE key IN ('views', 'impressions', 'likes', 'comments', 'shares', 'saves')
            AND NOT CASE
              WHEN jsonb_typeof(value) = 'null' THEN true
              WHEN jsonb_typeof(value) = 'number' THEN
                (value #>> '{}')::numeric BETWEEN 0 AND 9007199254740991
                AND trunc((value #>> '{}')::numeric) = (value #>> '{}')::numeric
              ELSE false END
        )
      THEN statistics->'metrics' ELSE NULL END AS metrics
      FROM social_post
      WHERE "projectId" = ${input.projectId}::uuid
        AND "workspaceId" = ${input.workspaceId}::uuid
        AND status = 'PUBLISHED'
        AND (${input.provider ?? null}::text IS NULL OR provider = ${input.provider ?? null}::text)
        AND (${input.publishedFrom ?? null}::timestamp IS NULL OR "publishedAt" >= ${input.publishedFrom ?? null}::timestamp)
        AND (${input.publishedUntil ?? null}::timestamp IS NULL OR "publishedAt" <= ${input.publishedUntil ?? null}::timestamp)
    )
    SELECT provider,
      count(*)::integer AS "postCount",
      count(*) FILTER (WHERE
        metrics->>'views' IS NOT NULL OR metrics->>'impressions' IS NOT NULL OR
        metrics->>'likes' IS NOT NULL OR metrics->>'comments' IS NOT NULL OR
        metrics->>'shares' IS NOT NULL OR metrics->>'saves' IS NOT NULL
      )::integer AS "measuredPostCount",
      jsonb_build_object(
        'views', sum((metrics->>'views')::numeric),
        'impressions', sum((metrics->>'impressions')::numeric),
        'likes', sum((metrics->>'likes')::numeric),
        'comments', sum((metrics->>'comments')::numeric),
        'shares', sum((metrics->>'shares')::numeric),
        'saves', sum((metrics->>'saves')::numeric)
      ) AS metrics
    FROM snapshots
    GROUP BY provider
    ORDER BY provider
  `);
  return {
    posts: page.posts,
    summary: z.array(socialPostStatisticsSummarySchema).parse(rows),
    nextCursor: page.pagination.nextCursor,
  };
}

export async function refreshSocialPostStatistics(input: {
  projectId: string;
  workspaceId: string;
  postId: string;
  userId: string;
}): Promise<SocialPostSummary> {
  const post = await getSocialPost(input);
  if (post.status !== "PUBLISHED" || !post.publishedExternalId) {
    throw badRequest(
      "Statistics are available only for confirmed published posts.",
    );
  }
  const previous = post.statistics ?? null;
  const attemptedAt = new Date().toISOString();
  let snapshot: SocialPostStatistics;
  try {
    const connection = post.socialConnection
      ? await prisma.projectSocialConnection.findFirst({
          where: {
            id: post.socialConnection.id,
            projectId: input.projectId,
            project: { workspaceId: input.workspaceId },
          },
        })
      : null;
    if (
      !connection ||
      connection.status !== "active" ||
      connection.provider !== post.provider
    ) {
      throw new SocialPostStatisticsUnavailableError(
        "Reconnect the original account to refresh statistics.",
      );
    }
    if (!(post.provider in SOCIAL_POST_TEXT_LIMITS)) {
      throw new SocialPostStatisticsUnavailableError(
        "Statistics are unavailable for this platform.",
      );
    }
    const metrics = socialPostMetricsSchema.parse(
      await fetchSocialPostStatistics({
        provider: connection.provider as keyof typeof SOCIAL_POST_TEXT_LIMITS,
        connectedAccountId: connection.composioConnectedAccountId,
        executorUserId: connection.connectorUserId,
        externalAccountId: connection.externalAccountId,
        externalId: post.publishedExternalId,
      }),
    );
    if (Object.values(metrics).every((value) => value === null)) {
      throw new SocialPostStatisticsUnavailableError(
        "The platform returned no available statistics. Check analytics permissions.",
      );
    }
    snapshot = {
      metrics,
      fetchedAt: new Date().toISOString(),
      refreshAttemptedAt: attemptedAt,
      error: null,
    };
  } catch (error) {
    snapshot = {
      metrics: previous?.metrics ?? { ...EMPTY_METRICS },
      fetchedAt: previous?.fetchedAt ?? null,
      refreshAttemptedAt: attemptedAt,
      error:
        error instanceof SocialPostStatisticsUnavailableError
          ? error.message
          : "Unable to refresh statistics. Check the connection and analytics permissions, then retry.",
    };
  }
  const statistics: Prisma.InputJsonObject = {
    metrics: { ...snapshot.metrics },
    fetchedAt: snapshot.fetchedAt,
    refreshAttemptedAt: snapshot.refreshAttemptedAt,
    error: snapshot.error,
  };
  const result = await prisma.socialPost.updateMany({
    where: {
      id: input.postId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      status: "PUBLISHED",
      publishedExternalId: post.publishedExternalId,
      // A slow refresh cannot replace results saved by another refresh.
      statistics: {
        equals: previous
          ? { ...previous, metrics: { ...previous.metrics } }
          : Prisma.DbNull,
      },
    },
    data: { statistics },
  });
  if (result.count === 0)
    throw conflict("Statistics changed during refresh. Reload the post.");
  return getSocialPost(input);
}
