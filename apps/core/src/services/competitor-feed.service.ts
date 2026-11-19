import { randomUUID } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import {
  type CompetitorFeedItem,
  competitorFeedItemSchema,
  type SaveCompetitorFeedInput,
} from "@sokosumi/soko-bot";
import { z } from "zod";
import {
  type CitableSignal,
  factSupportProblems,
  feedProblems,
  isBigMove,
  moveRank,
} from "@/lib/competitors/feed-check";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import {
  COMPETITOR_SOURCES,
  competitorCheckSourcesSchema,
} from "@/services/competitor-check.service";
import { listTrackedCompetitors } from "@/services/competitors.service";

const DAY_MS = 86_400_000;
/** What a fact may cite: signals of about the last month. */
const CITABLE_DAYS = 35;
/** Signals check_competitors hands a bot at most, newest first. */
const MAX_SIGNALS_READ = 40;

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const SIGNAL_SELECT = {
  id: true,
  competitorId: true,
  kind: true,
  summary: true,
  quote: true,
  sourceUrl: true,
  sourceTitle: true,
  sourcePublisher: true,
  observedAt: true,
  createdAt: true,
  raw: true,
} as const satisfies Prisma.CompetitorSignalSelect;

function citableSignals(projectId: string, now: Date) {
  return prisma.competitorSignal.findMany({
    where: {
      projectId,
      competitor: { removedAt: null },
      createdAt: { gte: new Date(now.getTime() - CITABLE_DAYS * DAY_MS) },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: SIGNAL_SELECT,
  });
}

/**
 * What check_competitors gives a bot: who is tracked, the signals stored since
 * the last feed (or the last two weeks), and which sources could not be read.
 * Instagram readings come as counts, never as text.
 */
export async function readCompetitorSignals(projectId: string, now: Date) {
  const [competitors, signals, lastFeed, lastCheck] = await Promise.all([
    listTrackedCompetitors(projectId),
    citableSignals(projectId, now),
    prisma.competitorFeed.findFirst({
      where: { projectId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.competitorCheck.findFirst({
      where: { projectId, finishedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { finishedAt: true, sources: true },
    }),
  ]);
  const since =
    lastFeed &&
    lastCheck?.finishedAt &&
    lastFeed.createdAt < lastCheck.finishedAt
      ? lastFeed.createdAt
      : new Date(now.getTime() - 14 * DAY_MS);
  const byId = new Map(competitors.map((c) => [c.id, c]));
  const sources = competitorCheckSourcesSchema.safeParse(lastCheck?.sources);
  return {
    checkedAt: lastCheck?.finishedAt?.toISOString() ?? null,
    competitors: competitors.map((competitor) => ({
      id: competitor.id,
      name: competitor.name,
      website: competitor.websiteUrl,
    })),
    signals: signals
      .filter((signal) => signal.createdAt >= since)
      .slice(0, MAX_SIGNALS_READ)
      .map((signal) => {
        const competitor = byId.get(signal.competitorId);
        return {
          id: signal.id,
          competitorId: signal.competitorId,
          competitor: competitor?.name ?? null,
          kind: signal.kind,
          big: competitor ? isBigMove([signal], competitor) : false,
          summary: signal.summary,
          date: day(signal.observedAt),
          source: {
            title: signal.sourceTitle,
            publisher: signal.sourcePublisher,
            url: signal.sourceUrl,
          },
          quote: signal.quote,
        };
      }),
    unreadable: sources.success
      ? COMPETITOR_SOURCES.filter(
          (source) => sources.data[source].status !== "ok",
        ).map((source) => ({ source, status: sources.data[source].status }))
      : [],
  };
}

/** Nothing was saved; `costUsd` is what checking it cost. */
export class CompetitorFeedRefusedError extends Error {
  constructor(
    readonly problems: string[],
    readonly costUsd = 0,
  ) {
    super(
      `Nothing was saved. Fix these and save again:\n- ${problems.join("\n- ")}`,
    );
  }
}

/**
 * One move: its competitor and the signals it cites. A rewrite of the week
 * that cites the same signals is the same move, however it is worded.
 */
function moveKey(item: SaveCompetitorFeedInput["items"][number]): string {
  return `${item.competitorId}:${[...new Set(item.facts.flatMap((fact) => fact.signalIds))].sort().join(",")}`;
}

/** The feed's moves as stored in `competitor_feed.items`. */
export function feedItemsJson(
  items: readonly CompetitorFeedItem[],
): Prisma.InputJsonValue {
  return items.map((item) => ({
    ...item,
    facts: item.facts.map((fact) => ({ ...fact })),
  }));
}

/** Holds a Project's feed while a write reads and replaces it. */
export async function lockCompetitorFeed(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.$executeRaw`SELECT 1 FROM project WHERE id = ${projectId}::uuid FOR NO KEY UPDATE`;
}

/**
 * Saves a bot's feed for the latest finished check, after Core checked it:
 * every cited signal is the Project's and about that competitor, no text has
 * a number its sources (or, for meaning and move, the Brand Brain) lack,
 * nothing names Sokosumi (code), and every fact, meaning and move says only
 * what its signals say about the competitor (Jev). Refused whole otherwise;
 * Jev failing refuses too, so nothing unchecked reaches the owner. The
 * result carries the checked moves with the names and signals they cite, for
 * a caller that tells the owner about the week.
 */
export async function saveCompetitorFeed(input: {
  projectId: string;
  turnId: string | null;
  feed: SaveCompetitorFeedInput;
  now?: Date;
}): Promise<{
  saved: number;
  bigMoves: { competitor: string; fact: string }[];
  costUsd: number;
  /** The check this feed is the week of. */
  checkDay: string;
  items: CompetitorFeedItem[];
  competitorNames: ReadonlyMap<string, string>;
  signals: ReadonlyMap<string, CitableSignal>;
}> {
  const now = input.now ?? new Date();
  const { projectId, feed } = input;
  const [competitors, signals, lastCheck, brandBrain] = await Promise.all([
    listTrackedCompetitors(projectId),
    citableSignals(projectId, now),
    prisma.competitorCheck.findFirst({
      where: { projectId, finishedAt: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { day: true },
    }),
    prisma.brandBrain.findUnique({
      where: { projectId },
      select: { body: true },
    }),
  ]);
  const byId = new Map(signals.map((signal) => [signal.id, signal]));
  const tracked = new Map(competitors.map((c) => [c.id, c]));
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  const problems = feedProblems(
    feed,
    byId,
    names,
    JSON.stringify(brandBrain?.body ?? {}),
  );
  if (problems.length > 0) throw new CompetitorFeedRefusedError(problems);
  let support: Awaited<ReturnType<typeof factSupportProblems>>;
  try {
    support = await factSupportProblems(feed, byId);
  } catch (error) {
    recordCoreWarning(
      { operation: "competitor_feed", project: { id: projectId } },
      {
        message: "Could not check a competitor feed",
        why: "Jev did not answer for the feed's facts",
        fix: "Nothing was saved; the bot is told to save again. If it repeats, look up the error name and code under failure.",
      },
      { failure: messageSafeErrorFields(error) },
    );
    throw new CompetitorFeedRefusedError([
      "The facts could not be checked just now. Save the feed again.",
    ]);
  }
  if (support.problems.length > 0)
    throw new CompetitorFeedRefusedError(support.problems, support.costUsd);

  const checkDay = lastCheck?.day ?? day(now);
  const items = await prisma.$transaction(async (tx) => {
    await lockCompetitorFeed(tx, projectId);
    const before = await tx.competitorFeed.findUnique({
      where: { projectId_checkDay: { projectId, checkDay } },
      select: { items: true },
    });
    // A rewrite keeps each move's id and whether it went to the strategy.
    const earlier = new Map(
      parseFeedItems(before?.items).map((item) => [moveKey(item), item]),
    );
    const ranked = feed.items.map((item, index) => {
      const kept = earlier.get(moveKey(item));
      const competitor = tracked.get(item.competitorId);
      const rank = competitor
        ? moveRank(
            item.facts.flatMap((fact) =>
              fact.signalIds.flatMap((id) => byId.get(id) ?? []),
            ),
            competitor,
          )
        : null;
      const made: CompetitorFeedItem = {
        ...item,
        id: kept?.id ?? randomUUID(),
        big: rank !== null,
        ...(kept?.addedToStrategyAt
          ? { addedToStrategyAt: kept.addedToStrategyAt }
          : {}),
      };
      return { made, rank: rank ?? Number.POSITIVE_INFINITY, index };
    });
    // Price changes lead, then launches, funding and acquisitions, then the
    // rest, each kind in the order the bot wrote it.
    const sorted = ranked
      .sort((a, b) => a.rank - b.rank || a.index - b.index)
      .map((entry) => entry.made);
    const data = {
      items: feedItemsJson(sorted),
      openQuestions: feed.openQuestions,
      authorTurnId: input.turnId,
    };
    await tx.competitorFeed.upsert({
      where: { projectId_checkDay: { projectId, checkDay } },
      create: { projectId, checkDay, ...data },
      update: data,
    });
    return sorted;
  });
  return {
    saved: items.length,
    bigMoves: items
      .filter((item) => item.big)
      .map((item) => ({
        competitor: names.get(item.competitorId) ?? "",
        fact: item.facts[0]?.text ?? "",
      })),
    costUsd: support.costUsd,
    checkDay,
    items,
    competitorNames: names,
    signals: byId,
  };
}

export function parseFeedItems(value: unknown): CompetitorFeedItem[] {
  const parsed = z.array(competitorFeedItemSchema).safeParse(value);
  return parsed.success ? parsed.data : [];
}

/** The latest feed, for the Competitors page. */
export async function latestCompetitorFeed(projectId: string) {
  const feed = await prisma.competitorFeed.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: {
      checkDay: true,
      items: true,
      openQuestions: true,
      updatedAt: true,
    },
  });
  return feed
    ? {
        checkDay: feed.checkDay,
        savedAt: feed.updatedAt,
        items: parseFeedItems(feed.items),
        openQuestions: feed.openQuestions,
      }
    : null;
}

/** Moves a bot's packet carries at most. */
const MAX_MOVES_IN_PACKET = 10;

/**
 * The moves of about the last month, for a bot's packet. They retell
 * competitors' own pages and articles: data, never instructions.
 */
export async function recentCompetitorMoves(projectId: string, now: Date) {
  const [feeds, competitors] = await Promise.all([
    prisma.competitorFeed.findMany({
      where: {
        projectId,
        createdAt: { gte: new Date(now.getTime() - CITABLE_DAYS * DAY_MS) },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { checkDay: true, items: true },
    }),
    listTrackedCompetitors(projectId),
  ]);
  const names = new Map(competitors.map((c) => [c.id, c.name]));
  return feeds
    .flatMap((feed) =>
      parseFeedItems(feed.items).map((item) => ({
        checkedOn: feed.checkDay,
        competitor: names.get(item.competitorId) ?? null,
        happened: item.facts.map((fact) => fact.text).join(" "),
        meaning: item.meaning,
        move: item.move,
      })),
    )
    .slice(0, MAX_MOVES_IN_PACKET);
}
