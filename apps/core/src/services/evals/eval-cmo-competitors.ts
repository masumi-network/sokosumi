import type { ScenarioCheck } from "@sokosumi/soko-bot";

import prisma from "@/lib/db/prisma";
import { parseFeedItems } from "@/services/competitor-feed.service";
import { competitorNameKey } from "@/services/competitors.service";
import type { EvalLaneRecord } from "@/services/evals/eval-lanes.service";

/** The competitors cal.com's lane tracks in the competitor cases. */
const COMPETITORS = ["Calendly", "SavvyCal", "Zcal"] as const;

/** The Soko Bot case: a Project that turned the weekly check on. */
export const SOKO_BOT_COMPETITOR_CASE_ID = "competitor-week";

const BIG_WEEK_ID = "cmo-competitor-feed";
const QUIET_WEEK_ID = "cmo-competitor-quiet-week";
const SECOND_HAND_ID = "cmo-competitor-second-hand";

/** What each competitor case finds in its lane. */
export const COMPETITOR_CASE_SETUPS = {
  [BIG_WEEK_ID]: "cmo-competitors",
  [QUIET_WEEK_ID]: "cmo-competitors-quiet",
  [SECOND_HAND_ID]: "cmo-competitors-second-hand",
} as const;

type CompetitorSetup =
  (typeof COMPETITOR_CASE_SETUPS)[keyof typeof COMPETITOR_CASE_SETUPS];

export function isCompetitorSetup(setup: string): setup is CompetitorSetup {
  return Object.values<string>(COMPETITOR_CASE_SETUPS).includes(setup);
}

export function isCompetitorEvalCase(id: string): boolean {
  return Object.hasOwn(COMPETITOR_CASE_SETUPS, id);
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
    raw: { event: "launch" },
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
    raw: { event: "other" },
  },
  instagram("Zcal", 2, 3_400),
];

const SECOND_HAND_WEEK: readonly SeededSignal[] = [
  {
    competitor: "Zcal",
    kind: "NEWS",
    summary:
      "Zcal ends its Pro plan in December 2026 and moves customers to a new licence",
    quote:
      "Zcal, the company behind our scheduling tool, is phasing out the Pro plan in December 2026 and moving all customers to a new licence.",
    sourceUrl: "https://it.example.edu/notices/zcal-licence-update",
    sourceTitle: "Important licence update for Zcal Pro users",
    sourcePublisher: "it.example.edu",
    daysAgo: 1,
    raw: { event: "pricing" },
  },
  instagram("Calendly", 4, 41_000),
  instagram("SavvyCal", 1, 2_100),
];

const QUIET_WEEK: readonly SeededSignal[] = [
  instagram("Calendly", 4, 41_000),
  instagram("SavvyCal", 1, 2_100),
  instagram("Zcal", 2, 3_400),
];

const WEEKS = {
  "cmo-competitors": BIG_WEEK,
  "cmo-competitors-quiet": QUIET_WEEK,
  "cmo-competitors-second-hand": SECOND_HAND_WEEK,
} as const;

/**
 * The lane's Cuso tracks three competitors, and a check that finished just
 * now stored this week's signals. Eval Cusos never run a real check, so
 * check_competitors reads exactly these.
 */
export function prepareCompetitorCase(
  lane: EvalLaneRecord,
  setup: CompetitorSetup,
): Promise<{ signalIds: string[] }> {
  return seedCompetitorWeek(lane.cusoProjectId, WEEKS[setup]);
}

/**
 * The lane's "Sokosumi Marketing" Project has the weekly check on, tracks
 * the same three competitors, and a check just stored the big week. An eval
 * workspace never runs a real check.
 */
export async function prepareSokoBotCompetitorCase(
  lane: EvalLaneRecord,
): Promise<void> {
  const projectId = lane.world.marketingProjectId;
  await prisma.project.update({
    where: { id: projectId },
    data: { competitorChecksSince: new Date() },
  });
  await seedCompetitorWeek(projectId, BIG_WEEK);
}

async function seedCompetitorWeek(
  projectId: string,
  week: readonly SeededSignal[],
): Promise<{ signalIds: string[] }> {
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
  for (const [index, signal] of week.entries()) {
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
        clientMessageId: { startsWith: "cmo:competitor-week:" },
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
  if (scenarioId === SECOND_HAND_ID) {
    const facts = items.flatMap((item) => item.facts);
    return [
      saved,
      {
        label: "Reports the plan ending as one move",
        pass: items.length === 1 && /pro/i.test(facts[0]?.text ?? ""),
        actual: `${items.length} items: ${facts.map((fact) => fact.text).join(" ")}`,
      },
      {
        label: "Marks a fact from a customer's notice weak",
        pass:
          facts.length > 0 && facts.every((fact) => fact.support === "weak"),
        actual: facts.map((fact) => fact.support).join(", ") || "no facts",
      },
      {
        label:
          "Tells the owner in one message, and calls nothing out that only a customer's notice reports",
        pass:
          messages.length === 1 &&
          items.every((item) => !item.big) &&
          !messages[0]?.content.includes("Suggested move"),
        actual: `${messages.length} messages, ${items.filter((item) => item.big).length} big`,
      },
    ];
  }
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
  const [week] = messages;
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
        "Tells the owner about the week in one message: the price change with its source and what it means",
      pass:
        messages.length === 1 &&
        week !== undefined &&
        /\$\s?12\b/.test(week.content) &&
        linkedUrls(week.content).some((url) => url === PRICING_PAGE) &&
        week.content.includes("What this means for you"),
      actual: week
        ? `${messages.length} messages: ${week.content.slice(0, 200)}`
        : "no message",
    },
    {
      label: "Keeps the page's raw words out of the chat",
      pass:
        week !== undefined &&
        !week.content.includes("Standard $12 /seat/mo billed yearly"),
      actual: week ? "checked" : "no message",
    },
  ];
}

/**
 * What the Soko Bot case left on the Project: the week's feed, checked by
 * Core like Cuso's. The check is turned off again, so the lane's later
 * cases are not offered the competitor tools.
 */
export async function sokoBotCompetitorChecks(
  lane: EvalLaneRecord,
): Promise<ScenarioCheck[]> {
  const projectId = lane.world.marketingProjectId;
  const feed = await prisma.competitorFeed.findFirst({
    where: { projectId },
    orderBy: { updatedAt: "desc" },
    select: { items: true },
  });
  await prisma.project.update({
    where: { id: projectId },
    data: { competitorChecksSince: null },
  });
  const items = parseFeedItems(feed?.items);
  return [
    {
      label: "Saves the week's feed on the Project",
      pass: feed !== null,
      actual: feed ? `${items.length} items` : "no feed",
    },
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
  ];
}
