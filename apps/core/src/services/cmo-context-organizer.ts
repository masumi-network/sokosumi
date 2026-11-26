import {
  CMO_PRODUCTION_TURN_PREFIX,
  CMO_RESEARCH_GROUPS,
  type CmoBrandSectionKey,
  cmoWritingSkills,
  getSokoBotVersion,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { createCoreLogger } from "@/lib/evlog";
import { askJev } from "@/lib/soko-bot/jev";
import { compactBrandBrain } from "@/services/brand-brain.service";
import type {
  CmoContextSources,
  MarketingContext,
} from "@/services/cmo-context.service";
import {
  cmoBrandLook,
  cmoBrandPicturesContext,
  cmoConnectedChannelsContext,
  cmoWeeklyLearnings,
  fitCmoMarketingContext,
  fullCmoMarketingContext,
} from "@/services/cmo-context.service";
import { cmoIndustryContext } from "@/services/cmo-industry.service";
import { cmoSitePagesContext } from "@/services/cmo-site-pages.service";
import { STRATEGY_TURN_PREFIX } from "@/services/marketing-strategy.service";

/**
 * Cuso's context on a version that reads on demand (cmo-v23, ADR 0080): a
 * small fixed core with a map of everything stored, what this turn needs
 * picked on top of it, and read tools for the rest. Code decides what a kind
 * of turn always needs; Jev, the classifier's model, picks what a message
 * asks about from the map. A strategy turn keeps the whole fitted context:
 * it rewrites the plan and its calendar.
 */

/** What a turn is for, from Core's own ids; the message is never trusted for it. */
export type CmoTurnKind =
  | "production"
  | "strategy"
  | "daily"
  | "weekly"
  | "brand"
  | "competitors"
  | "seo"
  | "chat"
  | "event"
  | "quiet";

export interface CmoTurn {
  source: string;
  clientTurnId: string | null;
  /** The message the turn answers, as the classifier read it. */
  message: string;
  /** Cuso's own last reply in this conversation, for a "yes, do it". */
  previousReply?: string | null;
}

/** Bytes the picked part may add on top of the core, by kind. */
const PICK_BUDGET_BYTES: Record<CmoTurnKind, number> = {
  production: 20 * 1_024,
  strategy: 0,
  daily: 16 * 1_024,
  weekly: 12 * 1_024,
  brand: 20 * 1_024,
  competitors: 10 * 1_024,
  seo: 10 * 1_024,
  chat: 12 * 1_024,
  event: 10 * 1_024,
  quiet: 0,
};
/** Items Jev may add on top of the kind's own. */
const MAX_JEV_ITEMS = 6;
/** Jev answers in about 350 ms; past this the turn goes on without it. */
const JEV_TIMEOUT_MS = 4_000;
/** Jev's "yes" a topic needs to be picked. */
const JEV_PICK_AT = 0.5;
/** Calendar weeks the map lists, from today. */
const MAP_WEEKS = 6;
/** Reports the map lists, newest first. */
const MAP_REPORTS = 6;
const DAY_MS = 86_400_000;

/** One thing stored for Cuso, as the map names it and a pick shows it. */
interface CmoContextItem {
  id: string;
  /** What it is, in a few words: the map line and Jev's question. */
  title: string;
  /** How to read it in full. */
  read: string;
  content: () => unknown;
  /** A shorter rendering when the whole does not fit. */
  short?: () => unknown;
  /**
   * Content made of lines, cut to what fits with the rest counted. A
   * calendar week of a big month is 160 pieces.
   */
  lines?: () => string[];
}

export interface CmoContextPick {
  id: string;
  bytes: number;
  /** "rule" (the kind always needs it), "jev 0.83", or "fallback". */
  why: string;
  /** Set when only part of it fit. */
  cut?: boolean;
}

/** What the organizer did, on the turn's packet for traces and evals. */
export interface CmoContextLog {
  kind: CmoTurnKind;
  coreBytes: number;
  pickedBytes: number;
  picked: CmoContextPick[];
  /** Map ids that did not fit the budget although picked. */
  dropped: string[];
  jev: { ms: number; asked: number; failed?: string } | null;
}

function bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value) ?? "");
}

function day(now: Date, offset: number): string {
  return new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
}

const CMO_RHYTHM_KINDS: Readonly<Record<string, CmoTurnKind>> = {
  "cmo-daily-run": "daily",
  "cmo-weekly-review": "weekly",
  "cmo-monthly-strategy": "strategy",
  "cmo-brand-refresh": "brand",
  "cmo-strategy-nudge": "quiet",
  dreaming: "quiet",
};

/** The kind of a turn, from its source, its Core-made id and its rhythm. */
export function cmoTurnKind(
  turn: Pick<CmoTurn, "source" | "clientTurnId">,
  scheduleKey: string | null,
): CmoTurnKind {
  const id = turn.clientTurnId ?? "";
  if (id.startsWith(CMO_PRODUCTION_TURN_PREFIX)) return "production";
  if (id.startsWith(STRATEGY_TURN_PREFIX)) return "strategy";
  if (turn.source === "SCHEDULE")
    return (scheduleKey && CMO_RHYTHM_KINDS[scheduleKey]) || "event";
  if (id.startsWith("cmo:onboarding:")) return "quiet";
  if (id.startsWith("cmo:competitors:")) return "competitors";
  if (id.startsWith("cmo:seo")) return "seo";
  if (turn.source === "CHAT" && !id.startsWith("watch:")) return "chat";
  return "event";
}

/** What the turn is for, in one line of the core. */
const KIND_CONTRACTS: Record<CmoTurnKind, string> = {
  production:
    "Production run: make the pieces your brief lists. The brief holds each piece; picked holds the brand and its pictures.",
  strategy:
    "Strategy turn: you see the Brand Brain and the whole strategy as before.",
  daily:
    "Daily run: keep today and the next days right, answer comments, react to news. picked holds the next days.",
  weekly:
    "Weekly review: measure last week from real numbers and suggest changes. picked holds the reports and last week.",
  brand:
    "Brand Brain refresh: compare the site with the Brand Brain in picked and save what changed.",
  competitors:
    "Competitor check: picked holds the moves found so far and the brand.",
  seo: "SEO work: picked holds the site's pages and the brand.",
  chat: "The owner wrote to you: answer them. Read what the answer needs before you answer about it.",
  event:
    "Core started this turn: do what its message asks. Read what it needs.",
  quiet: "Do only what the message asks; the map lists what is stored.",
};

function week(now: Date, index: number): { from: string; to: string } {
  return { from: day(now, index * 7), to: day(now, index * 7 + 6) };
}

function countBy(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .sort((left, right) => right[1] - left[1])
    .map(([value, count]) => `${value} ${count}`)
    .join(", ");
}

type Entry = MarketingStrategyPlan["calendar"][number];

/** A piece in one line: enough to name it, find it and see where it stands. */
export function cmoCalendarLine(entry: Entry): string {
  return [
    entry.id,
    `${entry.date}${entry.time ? ` ${entry.time}` : ""}`,
    `${entry.channel}/${entry.format}`,
    entry.pillar ?? "",
    entry.stage ?? "",
    entry.status,
    `"${entry.title}"`,
    entry.notSent ? `not sent: ${entry.notSent}` : "",
    entry.socialPostId && entry.socialPostId !== entry.id
      ? `post ${entry.socialPostId}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function calendarItem(
  calendar: readonly Entry[],
  range: { from: string; to: string },
  label: string,
): CmoContextItem | null {
  const pieces = calendar.filter(
    (entry) => entry.date >= range.from && entry.date <= range.to,
  );
  if (pieces.length === 0) return null;
  return {
    id: `calendar:${range.from}..${range.to}`,
    title: `calendar ${label} ${range.from} to ${range.to}: ${pieces.length} pieces (${countBy(pieces.map((entry) => entry.channel))})`,
    read: `read_calendar from ${range.from} to ${range.to}`,
    content: () => pieces.map(cmoCalendarLine),
    lines: () => pieces.map(cmoCalendarLine),
  };
}

function reportLine(report: CmoContextSources["reports"][number]): string {
  return `${report.at.slice(0, 10)} ${report.kind}: ${report.headline}`;
}

const STRATEGY_TOPICS: readonly {
  key: string;
  title: string;
  parts: readonly string[];
}[] = [
  {
    key: "idea",
    title: "the strategy's idea, goals, audience and positioning",
    parts: [
      "summary",
      "why",
      "goals",
      "audience",
      "positioning",
      "idea",
      "objective",
      "barrier",
      "alternatives",
      "ladder",
    ],
  },
  {
    key: "channels",
    title: "the networks, their cadence and the pace",
    parts: ["channels", "pace", "proposals", "start"],
  },
  {
    key: "funnel",
    title: "the funnel, campaigns and the weeks",
    parts: ["funnel", "campaigns", "weeks"],
  },
  {
    key: "measurement",
    title: "how results are measured and the before and after",
    parts: ["measurement", "beforeAfter"],
  },
  { key: "ads", title: "the ads plan and budget", parts: ["ads"] },
  {
    key: "improvements",
    title: "improvements only the owner can make",
    parts: ["improvements"],
  },
  {
    key: "previews",
    title: "the sample pieces in the strategy",
    parts: ["previews"],
  },
  {
    key: "questions",
    title: "the yes/no questions the owner answers about the strategy",
    parts: ["questions"],
  },
];

function present(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return value !== "";
}

/** Everything stored that a turn may need, as map items. */
export function cmoContextItems(
  sources: CmoContextSources,
  now: Date,
): CmoContextItem[] {
  const items: CmoContextItem[] = [];
  const brain = compactBrandBrain(sources.brandBrain);
  if (brain) {
    const { profile, questions, ...essentials } = brain as Record<
      string,
      unknown
    > & {
      profile?: Record<string, unknown>;
      questions?: unknown[];
    };
    const {
      reveal: _reveal,
      alternatives: _alternatives,
      channels: _channels,
      marketingToday: _today,
      ...voice
    } = essentials;
    items.push({
      id: "brand:essentials",
      title:
        "the Brand Brain's essentials: summary, voice, audience, products, offers, competitors, the customers' own words",
      read: "read_brand_brain part summary, voice, products, offers, …",
      content: () => voice,
    });
    for (const group of CMO_RESEARCH_GROUPS) {
      const sections = group.sections.filter(
        (section) => profile?.[section] !== undefined,
      );
      if (sections.length === 0) continue;
      items.push({
        id: `brand:${group.key}`,
        title: `the Brand Brain's ${group.label.toLowerCase()} research: ${sections.join(", ")}`,
        read: `read_brand_brain part ${sections[0]} (every finding)`,
        content: () =>
          Object.fromEntries(
            sections.map((section) => [
              section,
              (profile as Record<CmoBrandSectionKey, unknown>)[section],
            ]),
          ),
      });
    }
    if (questions && questions.length > 0)
      items.push({
        id: "brand:questions",
        title: "questions the Brand Brain still has for the owner",
        read: "read_brand_brain part questions",
        content: () => questions,
      });
  }
  items.push({
    id: "brand:look",
    title:
      "the brand's look: logo, DESIGN.md colours and fonts, the brand's own photos (file ids for visualFileIds)",
    read: "this item",
    content: () => ({
      ...cmoBrandLook(sources),
      brandPictures: cmoBrandPicturesContext(sources),
      ...(sources.project?.presenterFileId && sources.project.presenterConsentAt
        ? { ownerPresenter: true }
        : {}),
    }),
  });
  const strategy = sources.strategy;
  if (strategy) {
    for (const topic of STRATEGY_TOPICS) {
      const parts = topic.parts.filter((part) =>
        present((strategy as Record<string, unknown>)[part]),
      );
      if (parts.length === 0) continue;
      items.push({
        id: `strategy:${topic.key}`,
        title: `${topic.title} (${parts.join(", ")})`,
        read: `read_strategy part ${parts[0]}`,
        content: () =>
          Object.fromEntries(
            parts.map((part) => [
              part,
              (strategy as Record<string, unknown>)[part],
            ]),
          ),
      });
    }
    const calendar = strategy.calendar;
    const past = calendarItem(
      calendar,
      { from: day(now, -7), to: day(now, -1) },
      "last week",
    );
    if (past) items.push(past);
    for (let index = 0; index < MAP_WEEKS; index += 1) {
      const item = calendarItem(
        calendar,
        week(now, index),
        index === 0 ? "this week" : `week ${index + 1}`,
      );
      if (item) items.push(item);
    }
  }
  for (const report of sources.reports.slice(0, MAP_REPORTS))
    items.push({
      id: `report:${report.id}`,
      title: `report ${reportLine(report)}`,
      read: `read_report id ${report.id}`,
      content: () => {
        const {
          previousVersionId: _previous,
          versionId: _version,
          ...shown
        } = report;
        return shown;
      },
    });
  const learnings = cmoWeeklyLearnings(sources.reports);
  if (learnings.some((week) => week.learnings.length > 0))
    items.push({
      id: "reports:learnings",
      title: "the last weekly reviews' verdicts and lessons",
      read: "read_report kind weekly",
      content: () => learnings,
    });
  if (sources.competitorMoves.length > 0)
    items.push({
      id: "competitorMoves",
      title: `${sources.competitorMoves.length} competitor moves of about the last month`,
      read: "read_competitor_moves",
      content: () => sources.competitorMoves,
    });
  const industry = sources.industry;
  if (industry && industry.items.length > 0)
    items.push({
      id: "industryResearch",
      title: `research into the buyers' industry (${industry.industry}): ${industry.items.length} sourced news, trends and problems, researched ${industry.researchedAt.slice(0, 10)}`,
      read: "read_file Brand research/Industry/industry.md",
      content: () => cmoIndustryContext(industry),
      short: () => {
        const context = cmoIndustryContext(industry);
        return { ...context, items: context.items.slice(0, 12) };
      },
    });
  const site = sources.sitePages;
  if (site && site.pages.length > 0)
    items.push({
      id: "sitePages",
      title: `the site's ${site.pages.length} pages with a line each and their note file ids`,
      read: "read_file on a page's note",
      content: () => cmoSitePagesContext(site.pages, site.complete),
      short: () => {
        const context = cmoSitePagesContext(site.pages, site.complete);
        return {
          ...context,
          pages: context.pages.slice(0, 10),
          more: site.pages.length - Math.min(10, context.pages.length),
        };
      },
    });
  return items;
}

/** One line per network: what the plan runs and how often. */
function channelsLine(strategy: MarketingStrategyPlan | null): string | null {
  if (!strategy || strategy.channels.length === 0) return null;
  return strategy.channels
    .map((channel) => `${channel.channel} ${channel.cadence}`)
    .join("; ");
}

function calendarSpan(calendar: readonly Entry[]): string {
  if (calendar.length === 0) return "no pieces yet";
  const days = calendar.map((entry) => entry.date).sort();
  return `${calendar.length} pieces from ${days[0]} to ${days.at(-1)}`;
}

/** The fixed core every organized turn starts from. */
export function cmoContextCore(input: {
  sources: CmoContextSources;
  kind: CmoTurnKind;
  items: readonly CmoContextItem[];
  now: Date;
  planLevel: string | null;
}): Record<string, unknown> {
  const { sources, kind, items, now } = input;
  const strategy = sources.strategy;
  const writingSkills = cmoWritingSkills(
    getSokoBotVersion(sources.versionId).skills,
  );
  const calendar = strategy?.calendar ?? [];
  return {
    business: {
      name: sources.cuso.businessName,
      websiteUrl: sources.cuso.websiteUrl,
      marketingProjectId: sources.cuso.projectId,
    },
    today: now.toISOString().slice(0, 10),
    thisTurn: KIND_CONTRACTS[kind],
    strategy: strategy
      ? {
          month: strategy.month,
          approved: sources.strategyVersion?.approvedAt != null,
          goals: strategy.goals,
          ...(strategy.contentLanguage
            ? { contentLanguage: strategy.contentLanguage }
            : {}),
          pillars: strategy.pillars.map(
            (pillar) =>
              `${pillar.name} ${pillar.share}%${pillar.why ? `: ${pillar.why}` : ""}`,
          ),
          mix: strategy.mix
            .map((part) => `${part.approach} ${part.share}%`)
            .join("; "),
          channels: channelsLine(strategy),
          calendar: calendarSpan(calendar),
        }
      : null,
    subscriptionActive: sources.subscriptionActive,
    ...(input.planLevel ? { plan: input.planLevel } : {}),
    connectedChannels: cmoConnectedChannelsContext(sources.channels),
    existingAccounts: sources.existingAccounts,
    // A network's skill is known by its id; a playbook by when to use it.
    writingSkills: [
      writingSkills
        .filter((skill) => skill.channels.length)
        .map((skill) => skill.id)
        .join(", "),
      ...writingSkills
        .filter((skill) => !skill.channels.length)
        .map((skill) => `${skill.id}: ${skill.description}`),
    ],
    map: items.map((item) => ({
      id: item.id,
      what: item.title,
      read: item.read,
      bytes: bytes(item.content()),
    })),
  };
}

/** What a kind of turn always needs, picked before Jev reads the message. */
export function cmoRulePicks(
  kind: CmoTurnKind,
  items: readonly CmoContextItem[],
  now: Date,
): string[] {
  const has = (id: string) => items.some((item) => item.id === id);
  const thisWeek = items.find((item) =>
    item.id.startsWith(`calendar:${day(now, 0)}..`),
  )?.id;
  const ids = (() => {
    switch (kind) {
      case "production":
        // The site's pages before the industry: articles and page fixes
        // are written from them, and both shrink to fit.
        return [
          "brand:essentials",
          "brand:look",
          "sitePages",
          "industryResearch",
        ];
      case "daily":
        // The week last: its lines are by date, so a cut keeps the next days.
        return [
          "brand:essentials",
          "competitorMoves",
          "industryResearch",
          thisWeek,
        ];
      case "weekly":
        return [
          items.find((item) => item.id.startsWith(`calendar:${day(now, -7)}..`))
            ?.id,
          "reports:learnings",
          "strategy:measurement",
          ...items
            .filter((item) => item.id.startsWith("report:"))
            .slice(0, 2)
            .map((item) => item.id),
        ];
      case "brand":
        return [
          "brand:essentials",
          ...items
            .filter(
              (item) =>
                item.id.startsWith("brand:") &&
                item.id !== "brand:essentials" &&
                item.id !== "brand:look",
            )
            .map((item) => item.id),
        ];
      case "competitors":
        return ["competitorMoves", "brand:essentials"];
      case "seo":
        return ["sitePages", "brand:essentials"];
      default:
        return [];
    }
  })();
  return ids.filter((id): id is string => Boolean(id) && has(id as string));
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
] as const;
const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

/**
 * The days a message names, as YYYY-MM-DD: ISO dates, "14 Dec" or
 * "December 14" (the next such day from today), "tomorrow", and a weekday
 * (its next one, today included).
 */
export function cmoNamedDays(message: string, now: Date): string[] {
  const text = message.toLowerCase();
  const today = new Date(`${day(now, 0)}T00:00:00Z`);
  const next = (month: number, date: number): string | null => {
    if (date < 1 || date > 31) return null;
    const year = today.getUTCFullYear();
    for (const candidate of [year, year + 1]) {
      const at = new Date(Date.UTC(candidate, month, date));
      if (at.getUTCMonth() !== month) return null;
      if (at.getTime() >= today.getTime() - 7 * DAY_MS)
        return at.toISOString().slice(0, 10);
    }
    return null;
  };
  const days = new Set<string>();
  for (const match of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g))
    days.add(`${match[1]}-${match[2]}-${match[3]}`);
  const month = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?";
  for (const match of text.matchAll(
    new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"),
  )) {
    const found = next(MONTHS.indexOf(match[1] as never), Number(match[2]));
    if (found) days.add(found);
  }
  for (const match of text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}`, "g"),
  )) {
    const found = next(MONTHS.indexOf(match[2] as never), Number(match[1]));
    if (found) days.add(found);
  }
  if (/\btomorrow\b/.test(text)) days.add(day(now, 1));
  WEEKDAYS.forEach((name, weekday) => {
    if (!new RegExp(`\\b${name}`).test(text)) return;
    const ahead = (weekday - today.getUTCDay() + 7) % 7;
    days.add(day(now, ahead));
  });
  return [...days].sort();
}

/** The calendar items that hold the days a message names. */
export function cmoNamedDayPicks(
  message: string,
  items: readonly CmoContextItem[],
  now: Date,
): string[] {
  return [
    ...new Set(
      cmoNamedDays(message, now).flatMap((named) =>
        items
          .filter((item) => {
            const range =
              /^calendar:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(
                item.id,
              );
            return range && named >= range[1]! && named <= range[2]!;
          })
          .map((item) => item.id),
      ),
    ),
  ];
}

/** What a chat or event turn gets when Jev could not answer. */
function fallbackPicks(
  kind: CmoTurnKind,
  items: readonly CmoContextItem[],
  now: Date,
): string[] {
  if (kind !== "chat" && kind !== "event") return [];
  return [
    "brand:essentials",
    items.find((item) => item.id.startsWith(`calendar:${day(now, 0)}..`))?.id,
    items.find((item) => item.id.startsWith("report:"))?.id,
  ].filter(
    (id): id is string => Boolean(id) && items.some((item) => item.id === id),
  );
}

/** Kinds whose message Jev reads to pick from the map. */
const JEV_KINDS = new Set<CmoTurnKind>([
  "chat",
  "event",
  "daily",
  "weekly",
  "competitors",
  "seo",
]);

/** The seam to Jev; tests replace it. */
export type CmoContextPicker = (input: {
  message: string;
  previousReply: string | null;
  today: string;
  topics: Record<string, string>;
  timeoutMs: number;
}) => Promise<Map<string, number>>;

const MAX_MESSAGE_CHARS = 3_000;
const MAX_REPLY_CHARS = 1_200;

export const jevContextPicker: CmoContextPicker = ({
  message,
  previousReply,
  today,
  topics,
  timeoutMs,
}) =>
  askJev({
    state: {
      task: "A marketing lead is about to answer the latest message about the business's marketing. Decide which stored items they must read first.",
      today,
      latestMessage: message.slice(0, MAX_MESSAGE_CHARS),
      previousReply: previousReply?.slice(0, MAX_REPLY_CHARS) ?? null,
    },
    questions: Object.fromEntries(
      Object.entries(topics).map(([key, title]) => [
        key,
        `Does answering or acting on latestMessage need ${title}? When latestMessage only agrees to previousReply ("yes", "do it", "the second one"), judge what previousReply offered. Yes only when the answer or the work would be wrong, vague or guessed without it; a greeting or thanks needs nothing.`,
      ]),
    ),
    timeoutMs,
  });

function render(
  item: CmoContextItem,
  room: number,
): { content: unknown; cut: boolean } | null {
  const whole = item.content();
  if (bytes(whole) <= room) return { content: whole, cut: false };
  if (item.short) {
    const short = item.short();
    if (bytes(short) <= room) return { content: short, cut: true };
  }
  if (item.lines) {
    const lines = item.lines();
    const kept: string[] = [];
    for (const line of lines) {
      const next = [...kept, line];
      if (bytes({ lines: next, more: lines.length }) > room) break;
      kept.push(line);
    }
    if (kept.length === 0) return null;
    return {
      content: {
        lines: kept,
        more: `${lines.length - kept.length} more: ${item.read}`,
      },
      cut: true,
    };
  }
  return null;
}

/**
 * The organized context: the core, then the kind's own picks and Jev's in
 * order while they fit the budget. Never throws for Jev: a failed or slow
 * answer leaves the turn with its rule picks and a fallback.
 */
export async function organizeCmoContext(input: {
  sources: CmoContextSources;
  turn: CmoTurn;
  now: Date;
  picker?: CmoContextPicker;
  /** The rhythm's key when the caller already knows it (the context lab). */
  scheduleKey?: string | null;
}): Promise<MarketingContext> {
  const { sources, turn, now } = input;
  const scheduleKey =
    input.scheduleKey !== undefined
      ? input.scheduleKey
      : await scheduleKeyOf(turn);
  const kind = cmoTurnKind(turn, scheduleKey);
  const items = cmoContextItems(sources, now);
  const planLevel = await import("@/services/cmo-billing.service")
    .then(({ cmoPlanLevel }) => cmoPlanLevel(sources.cuso.projectId, now))
    .catch(() => null);
  const core = cmoContextCore({ sources, kind, items, now, planLevel });
  if (kind === "strategy") {
    // A strategy turn rewrites the plan and its calendar, so it keeps the
    // whole fitted context beside the core's map.
    const full = fitCmoMarketingContext(
      fullCmoMarketingContext(sources, now),
      now,
      32 * 1_024 - bytes(core),
    );
    const log: CmoContextLog = {
      kind,
      coreBytes: bytes(core),
      pickedBytes: bytes(full),
      picked: [{ id: "strategy:full", bytes: bytes(full), why: "rule" }],
      dropped: [],
      jev: null,
    };
    logOrganized(sources, log);
    return { ...full, core, organizer: log };
  }
  const wanted: { id: string; why: string }[] = cmoRulePicks(
    kind,
    items,
    now,
  ).map((id) => ({ id, why: "rule" }));
  // A day the message names is a lookup, not a judgement: its calendar week
  // comes along whatever Jev says. Jev once missed "the week of December 14".
  if (kind === "chat" || kind === "event")
    for (const id of cmoNamedDayPicks(turn.message, items, now))
      if (!wanted.some((pick) => pick.id === id))
        wanted.push({ id, why: "named day" });
  let jev: CmoContextLog["jev"] = null;
  if (JEV_KINDS.has(kind) && turn.message.trim()) {
    const candidates = items.filter(
      (item) => !wanted.some((pick) => pick.id === item.id),
    );
    const started = Date.now();
    try {
      const answers = await (input.picker ?? jevContextPicker)({
        message: turn.message,
        previousReply: turn.previousReply ?? null,
        today: now.toISOString().slice(0, 10),
        topics: Object.fromEntries(
          candidates.map((item, index) => [`t${index}`, item.title]),
        ),
        timeoutMs: JEV_TIMEOUT_MS,
      });
      jev = { ms: Date.now() - started, asked: candidates.length };
      const chosen = candidates
        .map((item, index) => ({
          item,
          probability: answers.get(`t${index}`) ?? 0,
        }))
        .filter(({ probability }) => probability >= JEV_PICK_AT)
        .sort((left, right) => right.probability - left.probability)
        .slice(0, MAX_JEV_ITEMS);
      wanted.push(
        ...chosen.map(({ item, probability }) => ({
          id: item.id,
          why: `jev ${probability.toFixed(2)}`,
        })),
      );
    } catch (error) {
      jev = {
        ms: Date.now() - started,
        asked: candidates.length,
        failed: error instanceof Error ? error.name : "unknown",
      };
      for (const id of fallbackPicks(kind, items, now))
        if (!wanted.some((pick) => pick.id === id))
          wanted.push({ id, why: "fallback" });
    }
  }
  const budget = PICK_BUDGET_BYTES[kind];
  const picked: Record<string, unknown>[] = [];
  const log: CmoContextLog = {
    kind,
    coreBytes: bytes(core),
    pickedBytes: 0,
    picked: [],
    dropped: [],
    jev,
  };
  for (const pick of wanted) {
    const item = items.find((candidate) => candidate.id === pick.id);
    if (!item) continue;
    const why = pick.why === "rule" ? "this kind of turn needs it" : pick.why;
    const room =
      budget - log.pickedBytes - bytes({ id: item.id, why, content: null });
    const shown = room > 0 ? render(item, room) : null;
    if (!shown) {
      log.dropped.push(item.id);
      continue;
    }
    const entry = { id: item.id, why, content: shown.content };
    const size = bytes(entry);
    picked.push(entry);
    log.pickedBytes += size;
    log.picked.push({
      id: item.id,
      bytes: size,
      why: pick.why,
      ...(shown.cut ? { cut: true } : {}),
    });
  }
  logOrganized(sources, log);
  return { core, picked, organizer: log };
}

async function scheduleKeyOf(
  turn: Pick<CmoTurn, "source" | "clientTurnId">,
): Promise<string | null> {
  if (turn.source !== "SCHEDULE") return null;
  const scheduleId = /^schedule:([0-9a-f-]{36}):/.exec(
    turn.clientTurnId ?? "",
  )?.[1];
  if (!scheduleId) return null;
  const schedule = await prisma.sokoBotSchedule
    .findUnique({ where: { id: scheduleId }, select: { systemKey: true } })
    .catch(() => null);
  return schedule?.systemKey ?? null;
}

function logOrganized(sources: CmoContextSources, log: CmoContextLog): void {
  createCoreLogger({
    operation: "cmo_context_organized",
    project: { id: sources.cuso.projectId },
    cmoContext: {
      kind: log.kind,
      coreBytes: log.coreBytes,
      pickedBytes: log.pickedBytes,
      picked: log.picked.map((pick) => `${pick.id}:${pick.why}`).join(","),
      dropped: log.dropped.join(","),
      jevMs: log.jev?.ms ?? null,
      jevFailed: log.jev?.failed ?? null,
    },
  }).emit();
}
