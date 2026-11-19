import { z } from "zod";

import { metaAdLibraryConfigured } from "@/clients/meta-ad-library.client";
import { getEnv } from "@/config/env";
import { averageEngagement } from "@/lib/competitors/instagram";
import { COMPETITOR_CHECK_CREDITS } from "@/lib/competitors/price";
import prisma from "@/lib/db/prisma";
import { isCmoProject } from "@/services/cmo-cuso.service";
import {
  CHECK_EVERY_MS,
  COMPETITOR_SOURCES,
  type CompetitorCheckSources,
  type CompetitorSourceStatus,
  competitorCheckSourcesSchema,
  projectInstagramConnection,
} from "@/services/competitor-check.service";
import { latestCompetitorFeed } from "@/services/competitor-feed.service";
import {
  listTrackedCompetitors,
  MAX_TRACKED_COMPETITORS,
} from "@/services/competitors.service";

const SIGNAL_DAYS = 35;
const MAX_SIGNALS = 200;
const WEEK_MS = 7 * 86_400_000;
/** Two readings this far apart or more make a week's follower growth. */
const GROWTH_GAP_MS = 5 * 86_400_000;

const SIGNAL_SELECT = {
  id: true,
  competitorId: true,
  kind: true,
  summary: true,
  observedAt: true,
  sourceUrl: true,
  sourceTitle: true,
  sourcePublisher: true,
  quote: true,
} as const;

interface Measure {
  value: number;
  sourceUrl: string | null;
  observedAt: Date;
}

/** What a SOCIAL signal's `raw` holds (`InstagramWeek`). */
const socialRawSchema = z.object({
  followers: z.number().nullable(),
  postsThisWeek: z.number(),
  engagementPerPost: z.number().nullable(),
  topPosts: z.array(
    z.object({
      url: z.string().nullable(),
      caption: z.string().nullable(),
      type: z.string().nullable(),
      postedAt: z.string(),
      likes: z.number().nullable(),
      comments: z.number().nullable(),
    }),
  ),
});

function measure(
  value: number | null | undefined,
  source: { sourceUrl: string | null; observedAt: Date },
): Measure | null {
  return typeof value === "number"
    ? { value, sourceUrl: source.sourceUrl, observedAt: source.observedAt }
    : null;
}

/** The newest reading, and the one a week before it, of each competitor. */
function socialReadings(
  signals: readonly {
    id: string;
    competitorId: string;
    observedAt: Date;
    sourceUrl: string | null;
    raw: unknown;
  }[],
) {
  const byCompetitor = new Map<
    string,
    {
      id: string;
      observedAt: Date;
      sourceUrl: string | null;
      week: z.infer<typeof socialRawSchema>;
      growth: Measure | null;
    }
  >();
  for (const signal of signals) {
    const week = socialRawSchema.safeParse(signal.raw);
    if (!week.success) continue;
    const newest = byCompetitor.get(signal.competitorId);
    if (!newest) {
      byCompetitor.set(signal.competitorId, {
        id: signal.id,
        observedAt: signal.observedAt,
        sourceUrl: signal.sourceUrl,
        week: week.data,
        growth: null,
      });
      continue;
    }
    const gap = newest.observedAt.getTime() - signal.observedAt.getTime();
    if (
      !newest.growth &&
      gap >= GROWTH_GAP_MS &&
      newest.week.followers !== null &&
      week.data.followers !== null
    ) {
      newest.growth = measure(
        newest.week.followers - week.data.followers,
        newest,
      );
    }
  }
  return byCompetitor;
}

function metric(metrics: unknown, key: string): number | null {
  const parsed = z
    .array(z.object({ key: z.string(), value: z.number().nullable() }))
    .safeParse(metrics);
  return parsed.success
    ? (parsed.data.find((item) => item.key === key)?.value ?? null)
    : null;
}

/** The business's own Instagram week, from its connected account's sync. */
async function ownScoreRow(
  connection: {
    id: string;
    externalHandle: string | null;
    performanceHeadFetchedAt: Date | null;
  } | null,
  name: string,
  now: Date,
) {
  const empty = {
    competitorId: null,
    name,
    postsPerWeek: null,
    engagementPerPost: null,
    followers: null,
    followerGrowth: null,
  };
  if (!connection) return empty;
  const sourceUrl = connection.externalHandle
    ? `https://www.instagram.com/${connection.externalHandle.replace(/^@/, "")}/`
    : null;
  const [posts, snapshots] = await Promise.all([
    prisma.socialAccountPost.findMany({
      where: {
        connectionId: connection.id,
        publishedAt: { gte: new Date(now.getTime() - WEEK_MS) },
      },
      select: { metrics: true },
    }),
    prisma.socialPerformanceSnapshot.findMany({
      where: {
        connectionId: connection.id,
        date: { gte: new Date(now.getTime() - 2 * WEEK_MS) },
      },
      orderBy: { date: "desc" },
      select: { date: true, metrics: true, fetchedAt: true },
    }),
  ]);
  const read = connection.performanceHeadFetchedAt;
  const counted = posts.flatMap((post) => {
    const parsed = z
      .object({ likes: z.number().nullable(), comments: z.number().nullable() })
      .safeParse(post.metrics);
    if (!parsed.success) return [];
    const { likes, comments } = parsed.data;
    return likes === null && comments === null
      ? []
      : [(likes ?? 0) + (comments ?? 0)];
  });
  const withFollowers = snapshots.flatMap((snapshot) => {
    const followers = metric(snapshot.metrics, "followers_count");
    return followers === null ? [] : [{ ...snapshot, followers }];
  });
  const [newest] = withFollowers;
  const earlier = newest
    ? withFollowers.find(
        (snapshot) =>
          newest.date.getTime() - snapshot.date.getTime() >= GROWTH_GAP_MS,
      )
    : undefined;
  return {
    ...empty,
    postsPerWeek: read
      ? measure(posts.length, { sourceUrl, observedAt: read })
      : null,
    engagementPerPost: read
      ? measure(averageEngagement(counted), { sourceUrl, observedAt: read })
      : null,
    followers: newest
      ? measure(newest.followers, { sourceUrl, observedAt: newest.fetchedAt })
      : null,
    followerGrowth:
      newest && earlier
        ? measure(newest.followers - earlier.followers, {
            sourceUrl,
            observedAt: newest.fetchedAt,
          })
        : null,
  };
}

/** What a source that cannot be read needs, in words the owner can act on. */
const SOURCE_NEEDS: Record<
  keyof CompetitorCheckSources,
  Partial<Record<CompetitorSourceStatus, string>>
> = {
  pages: {},
  news: { not_configured: "News search is not set up yet." },
  ads: {
    not_configured:
      "Reading ads needs access to Meta's Ad Library, which is not set up yet.",
  },
  social: {
    not_connected:
      "Connect your Instagram business account to see competitors' Instagram numbers.",
  },
};

/**
 * How each source stands: what the last check reported, unless Core's access
 * or the owner's connection says today that it cannot be read at all.
 */
function sourceStates(last: unknown, instagramConnected: boolean) {
  const reported = competitorCheckSourcesSchema.safeParse(last);
  const state = (source: keyof CompetitorCheckSources) =>
    reported.success && reported.data[source].status === "failed"
      ? ("failed" as const)
      : ("ok" as const);
  const statuses: Record<keyof CompetitorCheckSources, CompetitorSourceStatus> =
    {
      pages: state("pages"),
      news: getEnv().EXA_API_KEY ? state("news") : "not_configured",
      ads: metaAdLibraryConfigured() ? state("ads") : "not_configured",
      social: instagramConnected ? state("social") : "not_connected",
    };
  return Object.fromEntries(
    COMPETITOR_SOURCES.map((source) => [
      source,
      {
        status: statuses[source],
        needs: SOURCE_NEEDS[source][statuses[source]] ?? null,
      },
    ]),
  ) as Record<
    keyof CompetitorCheckSources,
    { status: CompetitorSourceStatus; needs: string | null }
  >;
}

/**
 * A Project's Competitors page: who is tracked, what the last 30 days'
 * checks found, the Instagram scoreboard, each competitor's strongest posts,
 * and how the check stands. A pure read; the weekly check does the writing.
 * `businessName` names the Project's own scoreboard row (its name otherwise).
 */
export async function getProjectCompetitors(
  projectId: string,
  options: { businessName?: string; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const [project, cmo, competitors, signals, social, lastCheck, instagram] =
    await Promise.all([
      prisma.project.findUniqueOrThrow({
        where: { id: projectId },
        select: { name: true, competitorChecksSince: true },
      }),
      isCmoProject(projectId),
      listTrackedCompetitors(projectId),
      prisma.competitorSignal.findMany({
        where: {
          projectId,
          competitor: { removedAt: null },
          // Every signal a feed fact can cite, so its source shows on hover.
          createdAt: {
            gte: new Date(now.getTime() - SIGNAL_DAYS * 86_400_000),
          },
        },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        take: MAX_SIGNALS,
        select: SIGNAL_SELECT,
      }),
      prisma.competitorSignal.findMany({
        where: {
          projectId,
          competitor: { removedAt: null },
          kind: "SOCIAL",
          observedAt: { gte: new Date(now.getTime() - 5 * WEEK_MS) },
        },
        orderBy: [{ observedAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          competitorId: true,
          observedAt: true,
          sourceUrl: true,
          raw: true,
        },
      }),
      prisma.competitorCheck.findFirst({
        where: { projectId, finishedAt: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, finishedAt: true, sources: true },
      }),
      projectInstagramConnection(projectId),
    ]);
  const readings = socialReadings(social);
  const feed = await latestCompetitorFeed(projectId);
  const own = await ownScoreRow(
    instagram,
    options.businessName ?? project.name,
    now,
  );
  return {
    competitors,
    feed: feed && {
      ...feed,
      // A move of a competitor the member stopped watching goes with it.
      items: feed.items
        .filter((item) =>
          competitors.some((competitor) => competitor.id === item.competitorId),
        )
        .map((item) => ({
          ...item,
          addedToStrategyAt: item.addedToStrategyAt ?? null,
        })),
    },
    limit: MAX_TRACKED_COMPETITORS,
    signals,
    scoreboard: [
      own,
      ...competitors.map((competitor) => {
        const reading = readings.get(competitor.id);
        return {
          competitorId: competitor.id,
          name: competitor.name,
          postsPerWeek: reading
            ? measure(reading.week.postsThisWeek, reading)
            : null,
          engagementPerPost: reading
            ? measure(reading.week.engagementPerPost, reading)
            : null,
          followers: reading ? measure(reading.week.followers, reading) : null,
          followerGrowth: reading?.growth ?? null,
        };
      }),
    ],
    topPosts: competitors.flatMap((competitor) => {
      const reading = readings.get(competitor.id);
      if (!reading) return [];
      return reading.week.topPosts.map((post) => ({
        competitorId: competitor.id,
        signalId: reading.id,
        ...post,
      }));
    }),
    check: {
      // A CMO Project's check runs while its Cuso is paid for.
      on: cmo || project.competitorChecksSince !== null,
      lastCheckedAt: lastCheck?.finishedAt ?? null,
      nextCheckAt: lastCheck
        ? new Date(lastCheck.createdAt.getTime() + CHECK_EVERY_MS)
        : null,
      creditsPerCompetitor: COMPETITOR_CHECK_CREDITS,
      sources: sourceStates(lastCheck?.sources, instagram !== null),
    },
  };
}
