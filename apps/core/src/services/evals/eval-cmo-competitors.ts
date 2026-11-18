import type { ScenarioCheck } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { parseFeedItems } from "@/services/cmo-competitor-feed.service";
import { competitorNameKey } from "@/services/cmo-competitors.service";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";

/** The competitors cal.com's lane tracks in the competitor cases. */
const COMPETITORS = ["Calendly", "SavvyCal", "Zcal"] as const;

const BIG_WEEK_ID = "cmo-competitor-feed";
const QUIET_WEEK_ID = "cmo-competitor-quiet-week";

/** What each competitor case finds in its lane. */
export const COMPETITOR_CASE_SETUPS = {
  [BIG_WEEK_ID]: "cmo-competitors",
  [QUIET_WEEK_ID]: "cmo-competitors-quiet",
} as const;

export function isCompetitorEvalCase(id: string): boolean {
  return id === BIG_WEEK_ID || id === QUIET_WEEK_ID;
}

interface SeededSignal {
  competitor: (typeof COMPETITORS)[number];
  kind: "PRICE_CHANGE" | "NEWS" | "SOCIAL";
  summary: string;
  quote: string | null;
  sourceUrl: string;
  sourceTitle: string;
  sourcePublisher: string;
  daysAgo: number;
  raw: object;
}

const instagram = (
  competitor: (typeof COMPETITORS)[number],
  posts: number,
  followers: number,
): SeededSignal => ({
  competitor,
  kind: "SOCIAL",
  summary: `${posts} Instagram posts this week, ${followers.toLocaleString("en-US")} followers`,
  quote: null,
  sourceUrl: `https://www.instagram.com/${competitor.toLowerCase()}/`,
  sourceTitle: `@${competitor.toLowerCase()} on Instagram`,
  sourcePublisher: "Instagram",
  daysAgo: 0,
  raw: {
    network: "instagram",
    handle: competitor.toLowerCase(),
    followers,
    postsThisWeek: posts,
    engagementPerPost: 120,
    topPosts: [],
  },
});

const BIG_WEEK: readonly SeededSignal[] = [
  {
    competitor: "Calendly",
    kind: "PRICE_CHANGE",
    summary: "Standard plan $10 -> $12 per seat a month",
    quote: "Standard $12 /seat/mo billed yearly",
    sourceUrl: "https://calendly.com/pricing",
    sourceTitle: "Calendly pricing",
    sourcePublisher: "Calendly",
    daysAgo: 0,
    raw: {
      page: "PRICING",
      about: "pricing",
      prices: { before: ["$10"], after: ["$12"] },
      added: ["Standard", "$12 /seat/mo billed yearly"],
      removed: ["$10 /seat/mo billed yearly"],
    },
  },
  {
    competitor: "SavvyCal",
    kind: "NEWS",
    summary: "SavvyCal launched round-robin scheduling for teams",
    quote:
      "Today we're launching round-robin scheduling, so teams can share one link and spread meetings evenly.",
    sourceUrl: "https://savvycal.com/articles/round-robin",
    sourceTitle: "Introducing round-robin scheduling",
    sourcePublisher: "savvycal.com",
    daysAgo: 3,
    raw: {},
  },
  {
    competitor: "Calendly",
    kind: "NEWS",
    summary: "Calendly published a guide to taking meeting notes",
    quote: "Good meeting notes start before the meeting does.",
    sourceUrl: "https://calendly.com/blog/meeting-notes",
    sourceTitle: "How to take meeting notes",
    sourcePublisher: "calendly.com",
    daysAgo: 4,
    raw: {},
  },
  instagram("Zcal", 2, 3_400),
];

const QUIET_WEEK: readonly SeededSignal[] = [
  instagram("Calendly", 4, 41_000),
  instagram("SavvyCal", 1, 2_100),
  instagram("Zcal", 2, 3_400),
];

/**
 * The lane's Cuso tracks three competitors, and a check that finished just
 * now stored this week's signals. Eval Cusos never run a real check, so
 * check_competitors reads exactly these.
 */
export async function prepareCompetitorCase(
  lane: EvalLaneRecord,
  quiet: boolean,
): Promise<{ signalIds: string[] }> {
  const projectId = lane.cusoProjectId;
  await prisma.trackedCompetitor.deleteMany({ where: { projectId } });
  await prisma.competitorCheck.deleteMany({ where: { projectId } });
  await prisma.competitorFeed.deleteMany({ where: { projectId } });
  const now = new Date();
  const ids = new Map<string, string>();
  for (const name of COMPETITORS) {
    const created = await prisma.trackedCompetitor.create({
      data: {
        projectId,
        name,
        nameKey: competitorNameKey(name),
        researchKey: competitorNameKey(name),
        websiteUrl: `https://${name.toLowerCase()}.com/`,
        source: "RESEARCH",
      },
      select: { id: true },
    });
    ids.set(name, created.id);
  }
  await prisma.competitorCheck.create({
    data: {
      projectId,
      day: now.toISOString().slice(0, 10),
      createdAt: now,
      finishedAt: now,
      competitorCount: COMPETITORS.length,
      sources: {
        pages: { status: "ok" },
        news: { status: "ok" },
        ads: { status: "not_configured" },
        social: { status: "ok" },
      },
    },
  });
  const signalIds: string[] = [];
  for (const [index, signal] of (quiet ? QUIET_WEEK : BIG_WEEK).entries()) {
    const { competitor, daysAgo, ...data } = signal;
    const created = await prisma.competitorSignal.create({
      data: {
        ...data,
        projectId,
        competitorId: ids.get(competitor) ?? "",
        observedAt: new Date(now.getTime() - daysAgo * 86_400_000),
        dedupeKey: `eval:${index}`,
      },
      select: { id: true },
    });
    signalIds.push(created.id);
  }
  return { signalIds };
}

const PRICING_PAGE = "https://calendly.com/pricing";

/** The addresses a message links to, as its Markdown links give them. */
function linkedUrls(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^()\s]+)\)/g)].flatMap(([, url = ""]) => {
    const parsed = URL.parse(url);
    return parsed ? [parsed.href] : [];
  });
}

/** The feed and the chat messages the case left, read after the turn. */
export async function competitorFeedChecks(
  lane: EvalLaneRecord,
  scenarioId: string,
  startedAt: Date,
): Promise<ScenarioCheck[]> {
  const [feed, messages] = await Promise.all([
    prisma.competitorFeed.findFirst({
      where: { projectId: lane.cusoProjectId },
      orderBy: { updatedAt: "desc" },
      select: { items: true, openQuestions: true },
    }),
    prisma.chatRoomMessage.findMany({
      where: {
        senderSokoBotId: lane.cusoBotId,
        clientMessageId: { startsWith: "cmo:competitor-move:" },
        createdAt: { gte: startedAt },
      },
      select: { content: true },
    }),
  ]);
  const items = parseFeedItems(feed?.items);
  const saved: ScenarioCheck = {
    label: "Saves the week's feed",
    pass: feed !== null,
    actual: feed ? `${items.length} items` : "no feed",
  };
  if (scenarioId === QUIET_WEEK_ID)
    return [
      saved,
      {
        label: "Reports no move in a quiet week, and says what is open",
        pass: items.length === 0 && (feed?.openQuestions.length ?? 0) > 0,
        actual: `${items.length} items, ${feed?.openQuestions.length ?? 0} open questions`,
      },
      {
        label: "Tells the owner nothing",
        pass: messages.length === 0,
        actual: `${messages.length} messages`,
      },
    ];
  const price = messages.find((message) => /\$\s?12\b/.test(message.content));
  return [
    saved,
    {
      label: "Leads with the price change, flagged as a big move",
      pass: items[0]?.big === true,
      actual: `${items.filter((item) => item.big).length} big`,
    },
    {
      label: "Says the price went from $10 to $12",
      pass: items.some((item) =>
        item.facts.some(
          (fact) => /\b10\b/.test(fact.text) && /\b12\b/.test(fact.text),
        ),
      ),
      actual: items[0]?.facts.map((fact) => fact.text).join(" ") ?? "no items",
    },
    {
      label: "Leaves the meeting-notes guide and the Instagram counts out",
      pass: items.length <= 2,
      actual: `${items.length} items`,
    },
    {
      label:
        "Tells the owner about the price change at once, with source, date, quote and what it means",
      pass:
        price !== undefined &&
        linkedUrls(price.content).some((url) => url === PRICING_PAGE) &&
        price.content.includes("Standard $12 /seat/mo billed yearly") &&
        /\d{4}-\d{2}-\d{2}/.test(price.content) &&
        price.content.includes("What this means for you"),
      actual: price
        ? price.content.slice(0, 200)
        : `${messages.length} messages, none about $12`,
    },
  ];
}
