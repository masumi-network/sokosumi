import type { MarketingStrategy } from "@sokosumi/database";
import {
  type BrandBrain,
  type CmoSystemSchedule,
  cmoReadsOnDemand,
  cmoRoutineSkipReason,
  cmoWritingSkills,
  getSokoBotVersion,
  type MarketingStrategyPlan,
} from "@sokosumi/soko-bot";
import prisma from "@/lib/db/prisma";
import { readDesignMdContent } from "@/lib/design-md-blob";
import {
  compactBrandBrain,
  parseBrandBrain,
} from "@/services/brand-brain.service";
import { isCmoSubscribed } from "@/services/cmo-billing.service";
import { listCmoBrandPictures } from "@/services/cmo-brand-media.service";
import {
  type CmoTurn,
  organizeCmoContext,
} from "@/services/cmo-context-organizer";
import {
  type Cuso,
  cmoSiteAccountNetworks,
  findCusoForBot,
  listCmoChannels,
} from "@/services/cmo-cuso.service";
import {
  cmoIndustryContext,
  cmoReadsIndustry,
  readCmoIndustry,
} from "@/services/cmo-industry.service";
import {
  type CmoUpdateRecord,
  listCmoReports,
} from "@/services/cmo-reports.service";
import {
  cmoReadsSitePages,
  cmoSitePagesContext,
  readCmoSitePages,
} from "@/services/cmo-site-pages.service";
import {
  CMO_VISIBLE_CALENDAR_DAYS,
  calendarBounds,
  cmoWorkingStrategy,
} from "@/services/cmo-strategy.service";
import { recentCompetitorMoves } from "@/services/competitor-feed.service";
import {
  approvedMarketingStrategy,
  newestMarketingStrategy,
  readMarketingPlan,
} from "@/services/marketing-strategy.service";

function calendarWindow(
  strategy: MarketingStrategyPlan,
  now: Date,
  days: number,
): MarketingStrategyPlan["calendar"] {
  const { from, to } = calendarBounds(now, days);
  return strategy.calendar.filter(
    (entry) => entry.date >= from && entry.date <= to,
  );
}

/** Everything Cuso's context is built from, read once per turn. */
export interface CmoContextSources {
  cuso: Cuso;
  versionId: string | null;
  strategyVersion: MarketingStrategy | null;
  /** The plan with its Social posts under their ids (ADR 0062). */
  strategy: MarketingStrategyPlan | null;
  brandBrain: BrandBrain | null;
  project: {
    logo: string | null;
    designMdUrl: string | null;
    presenterFileId: string | null;
    presenterConsentAt: Date | null;
  } | null;
  designMd: string | null;
  brandPictures: Awaited<ReturnType<typeof listCmoBrandPictures>>;
  reports: CmoUpdateRecord[];
  competitorMoves: Awaited<ReturnType<typeof recentCompetitorMoves>>;
  channels: Awaited<ReturnType<typeof listCmoChannels>>;
  existingAccounts: string[];
  subscriptionActive: boolean;
  sitePages: Awaited<ReturnType<typeof readCmoSitePages>> | null;
  industry: Awaited<ReturnType<typeof readCmoIndustry>> | null;
}

/**
 * Reads what Cuso's context is built from. Rhythms and production
 * (`executing`) read only the approved version; other turns the newest. Null
 * for any bot that is not a CMO bot.
 */
export async function readCmoContextSources(
  sokoBotId: string,
  now: Date,
  options: { executing?: boolean } = {},
): Promise<CmoContextSources | null> {
  const cuso = await findCusoForBot(sokoBotId);
  if (!cuso) return null;
  const strategyVersion = await cmoWorkingStrategy(
    cuso.projectId,
    options.executing ?? false,
  );
  const [
    strategy,
    project,
    brandPictures,
    reports,
    competitorMoves,
    channels,
    existingAccounts,
    subscriptionActive,
    bot,
  ] = await Promise.all([
    readMarketingPlan(strategyVersion),
    prisma.project.findUnique({
      where: { id: cuso.projectId },
      select: {
        logo: true,
        designMdUrl: true,
        presenterFileId: true,
        presenterConsentAt: true,
      },
    }),
    listCmoBrandPictures(cuso.projectId),
    listCmoReports(sokoBotId, REPORTS_READ),
    recentCompetitorMoves(cuso.projectId, now),
    listCmoChannels(cuso.projectId),
    cmoSiteAccountNetworks(cuso),
    isCmoSubscribed(cuso),
    prisma.sokoBot.findUnique({
      where: { id: sokoBotId },
      select: { versionId: true },
    }),
  ]);
  const versionId = bot?.versionId ?? null;
  const [designMd, sitePages, industry] = await Promise.all([
    readDesignMdContent(project?.designMdUrl ?? null),
    cmoReadsSitePages(versionId)
      ? readCmoSitePages(cuso.projectId).catch(() => null)
      : null,
    cmoReadsIndustry(versionId)
      ? readCmoIndustry(cuso.projectId).catch(() => null)
      : null,
  ]);
  return {
    cuso,
    versionId,
    strategyVersion,
    strategy,
    brandBrain: parseBrandBrain(cuso.brandBrain),
    project,
    designMd: designMd ?? null,
    brandPictures,
    reports,
    competitorMoves,
    channels,
    existingAccounts,
    subscriptionActive,
    sitePages,
    industry,
  };
}

/**
 * What Cuso sees about the business on every turn: the Brand Brain, the
 * strategy, and the next 31 days of the calendar. Entries outside that
 * window stay in the saved plan. A version that reads on demand (cmo-v23)
 * gets a small core and what the turn needs instead, except on a strategy
 * turn (`cmo-context-organizer.ts`).
 */
export async function loadCmoMarketingContext(
  sokoBotId: string,
  now: Date = new Date(),
  options: { executing?: boolean; turn?: CmoTurn } = {},
): Promise<Record<string, unknown> | null> {
  const sources = await readCmoContextSources(sokoBotId, now, options);
  if (!sources) return null;
  if (
    options.turn &&
    cmoReadsOnDemand(getSokoBotVersion(sources.versionId).skills)
  )
    return organizeCmoContext({ sources, turn: options.turn, now });
  return fitCmoMarketingContext(fullCmoMarketingContext(sources, now), now);
}

/** The whole marketing context before it is fitted to its budget. */
export function fullCmoMarketingContext(
  sources: CmoContextSources,
  now: Date,
): MarketingContext {
  const { cuso, strategy, project, reports } = sources;
  const context: MarketingContext = {
    business: {
      name: cuso.businessName,
      websiteUrl: cuso.websiteUrl,
      marketingProjectId: cuso.projectId,
    },
    /** Whether the strategy shown is the approved version Cuso carries out. */
    strategyApproved: sources.strategyVersion?.approvedAt != null,
    subscriptionActive: sources.subscriptionActive,
    connectedChannels: cmoConnectedChannelsContext(sources.channels),
    /**
     * Networks the business already has an account on (connected here or to
     * its other Cuso for this website): plan them as existing accounts.
     */
    existingAccounts: sources.existingAccounts,
    brandBrain: compactBrandBrain(sources.brandBrain),
    /**
     * The Project's logo and DESIGN.md (colours, fonts, type): use them in
     * images and layouts.
     */
    brandLook: cmoBrandLook(sources),
    /** The brand's own photos, the Project's files: generate_image references. */
    brandPictures: cmoBrandPicturesContext(sources),
    /**
     * The owner gave their photo, with consent, to be the face of talking
     * videos: presenter "owner" uses it.
     */
    ...(project?.presenterFileId && project.presenterConsentAt
      ? { ownerPresenter: true }
      : {}),
    /** How to write each kind of piece: read one in full with read_writing_skill. */
    writingSkills: cmoWritingSkills(
      getSokoBotVersion(sources.versionId).skills,
    ).map((skill) => ({
      id: skill.id,
      name: skill.name,
      use: skill.description,
    })),
    strategy: strategy
      ? {
          ...strategy,
          // Next 31 days. saveCmoStrategy puts entries outside this window back.
          // Drafts past the first week stay stored: keepCalendarWork restores
          // them when an entry comes back under its id and title without one.
          calendar: calendarWindow(
            strategy,
            now,
            CMO_VISIBLE_CALENDAR_DAYS,
          ).map(({ socialPostId, ...entry }) => ({
            ...entry,
            // A Social post's entry is already under the post's id.
            ...(socialPostId && socialPostId !== entry.id
              ? { socialPostId }
              : {}),
            ...(entry.date > draftHorizon(now)
              ? {
                  draft: undefined,
                  brief: undefined,
                  why: undefined,
                  hook: undefined,
                  visual: undefined,
                  visualFileIds: undefined,
                  slides: undefined,
                  detailsStored: true,
                }
              : {}),
          })),
          calendarTotal: strategy.calendar.length,
        }
      : null,
    recentUpdates: reports
      .slice(0, 3)
      .map(
        ({ previousVersionId: _previous, versionId: _version, ...update }) =>
          update,
      ),
    /** The last weekly reviews' calls and lessons, newest first: the next plan builds on them. */
    weeklyLearnings: cmoWeeklyLearnings(reports),
  };
  const site = sources.sitePages;
  /** Every page of the site: read a page's note with read_file. */
  if (site && site.pages.length > 0)
    context.sitePages = cmoSitePagesContext(site.pages, site.complete);
  const industry = sources.industry;
  /** The buyer's industry with sources (cmo-v21): pillars and helpful tips rest on it. */
  if (industry && industry.items.length > 0)
    context.industryResearch = cmoIndustryContext(industry);
  if (sources.competitorMoves.length > 0)
    /** The competitor feed's moves of about the last month, newest first. */
    context.competitorMoves = sources.competitorMoves;
  return context;
}

export function cmoConnectedChannelsContext(
  channels: CmoContextSources["channels"],
) {
  return channels.map((channel) => ({
    provider: channel.provider,
    handle: channel.externalHandle,
    status: channel.status,
    socialConnectionId: channel.id,
  }));
}

export function cmoBrandLook(sources: CmoContextSources) {
  return {
    logoUrl: sources.project?.logo ?? null,
    designMd: sources.designMd?.slice(0, CMO_DESIGN_MD_CHARS) ?? null,
  };
}

export function cmoBrandPicturesContext(sources: CmoContextSources) {
  return sources.brandPictures
    .filter((picture) => !picture.fromSite)
    .map((picture) => ({
      fileId: picture.fileId,
      alt: picture.alt.slice(0, 80),
    }));
}

export function cmoWeeklyLearnings(reports: readonly CmoUpdateRecord[]) {
  return reports
    .filter((report) => report.kind === "weekly")
    .slice(0, WEEKLY_LEARNINGS)
    .map((report) => ({
      at: report.at.slice(0, 10),
      verdict: report.verdict ?? null,
      learnings: report.learnings ?? [],
    }));
}

/** Site pages Cuso's context keeps when the packet is tight. */
const SITE_PAGES_WHEN_TIGHT = 10;
/** Industry items it keeps then; the rest are in Brand research/Industry/industry.md. */
const INDUSTRY_ITEMS_WHEN_TIGHT = 12;

/** Weekly reviews whose learnings Cuso sees: about a month. */
const WEEKLY_LEARNINGS = 4;
/** Reports read to find them among the daily and production ones. */
const REPORTS_READ = 60;

/** Enough DESIGN.md for colours, fonts and type, as Image Studio reads it. */
const CMO_DESIGN_MD_CHARS = 1_600;

/**
 * Bytes Cuso's marketing context may take of the 48 KB packet; the rest is
 * memory, the conversation and the trigger. A big Brand Brain with a made
 * month once pushed the packet past its hard limit and every turn failed.
 */
export const CMO_CONTEXT_BUDGET_BYTES = 32 * 1_024;

/** What a piece past two weeks keeps when the packet is tight. */
const SHORT_ENTRY_KEYS = [
  "id",
  "date",
  "channel",
  "format",
  "pillar",
  "title",
  "status",
] as const;

export type MarketingContext = Record<string, unknown> & {
  brandBrain?: Record<string, unknown> | null;
  strategy?: (Record<string, unknown> & { calendar?: unknown[] }) | null;
};

/** The Brand Brain with each profile section cut to these keys. */
function profileKeeping(
  context: MarketingContext,
  keys: readonly string[],
): MarketingContext {
  const brain = context.brandBrain;
  if (!brain) return context;
  const profile = (brain.profile ?? {}) as Record<
    string,
    Record<string, unknown>
  >;
  return {
    ...context,
    brandBrain: {
      ...brain,
      profile: Object.fromEntries(
        Object.entries(profile).map(([name, section]) => [
          name,
          Object.fromEntries(keys.map((key) => [key, section[key]])),
        ]),
      ),
    },
  };
}

/**
 * Sheds detail, least needed first, until the context fits its budget.
 * Everything shed stays stored: saves merge into what is there, and a piece
 * sent back under its id and title keeps its words.
 */
export function fitCmoMarketingContext(
  context: MarketingContext,
  now: Date,
  budget: number = CMO_CONTEXT_BUDGET_BYTES,
): MarketingContext {
  const soon = new Date(now.getTime() + 3 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const later = (entry: Record<string, unknown>) =>
    typeof entry.date === "string" && entry.date > soon;
  const twoWeeks = new Date(now.getTime() + 14 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const oneWeek = draftHorizon(now);
  const calendar = (
    current: MarketingContext,
    shed: (entry: Record<string, unknown>) => Record<string, unknown>,
  ): MarketingContext =>
    current.strategy
      ? {
          ...current,
          strategy: {
            ...current.strategy,
            calendar: (current.strategy.calendar ?? []).map((entry) =>
              later(entry as Record<string, unknown>)
                ? shed(entry as Record<string, unknown>)
                : entry,
            ),
          },
        }
      : current;
  const without = (
    current: MarketingContext,
    part: "brandBrain" | "strategy",
    keys: string[],
  ): MarketingContext => {
    const value = current[part];
    const shed = value ? keys.filter((key) => key in value) : [];
    if (!value || shed.length === 0) return current;
    const kept = Object.fromEntries(
      Object.entries(value).filter(([key]) => !shed.includes(key)),
    );
    const stored = [
      ...((value.storedNotShown as string[] | undefined) ?? []),
      ...shed,
    ];
    return { ...current, [part]: { ...kept, storedNotShown: stored } };
  };
  const steps: ((current: MarketingContext) => MarketingContext)[] = [
    // The site's pages first: each one's note is a read_file away.
    (current) => {
      const site = current.sitePages as
        | { complete: boolean; pages: string[] }
        | undefined;
      return site && site.pages.length > SITE_PAGES_WHEN_TIGHT
        ? {
            ...current,
            sitePages: {
              ...site,
              pages: site.pages.slice(0, SITE_PAGES_WHEN_TIGHT),
              more:
                site.pages.length -
                SITE_PAGES_WHEN_TIGHT +
                ((site as { more?: number }).more ?? 0),
            },
          }
        : current;
    },
    (current) => {
      const industry = current.industryResearch as
        | { items: string[] }
        | undefined;
      return industry && industry.items.length > INDUSTRY_ITEMS_WHEN_TIGHT
        ? {
            ...current,
            industryResearch: {
              ...industry,
              items: industry.items.slice(0, INDUSTRY_ITEMS_WHEN_TIGHT),
            },
          }
        : current;
    },
    (current) =>
      calendar(
        current,
        ({
          draft: _draft,
          visual: _visual,
          visualFileIds: _files,
          slides: _slides,
          ...entry
        }) => ({
          ...entry,
          detailsStored: true,
        }),
      ),
    (current) => without(current, "strategy", ["previews", "weeks"]),
    (current) =>
      calendar(current, ({ brief: _b, why: _w, hook: _h, ...entry }) => ({
        ...entry,
        detailsStored: true,
      })),
    (current) => profileKeeping(current, ["headline", "answer"]),
    (current) =>
      without(current, "strategy", [
        "alternatives",
        "beforeAfter",
        "measurement",
        "proposals",
        "changes",
      ]),
    (current) =>
      without(current, "brandBrain", ["reveal", "alternatives", "channels"]),
    (current) =>
      calendar(current, ({ pillar: _p, campaignId: _c, ...entry }) => entry),
    // Before any piece past two weeks: what the Brand Brain still had to ask,
    // then the profile's answers.
    (current) => without(current, "brandBrain", ["questions"]),
    (current) => profileKeeping(current, ["headline"]),
    // Pieces past two weeks as one short line each, so a change can still
    // name every entry it touches (cutting a channel, a new audience).
    (current) =>
      current.strategy
        ? {
            ...current,
            strategy: {
              ...current.strategy,
              calendar: (current.strategy.calendar ?? []).map((entry) => {
                const piece = entry as Record<string, unknown>;
                return typeof piece.date === "string" && piece.date > twoWeeks
                  ? shortEntry(piece)
                  : entry;
              }),
            },
          }
        : current,
    // The next two weeks only. A 60-piece month with its visuals once left
    // no room in the packet, and every run failed to start.
    (current) => calendarUntil(current, twoWeeks),
    (current) =>
      without(current, "strategy", ["patched", "start", "campaigns", "funnel"]),
    (current) => without(current, "brandBrain", ["competitors"]),
    // A top-volume month holds 80 pieces in two weeks; a turn that still
    // cannot fit reads a piece with get_social_post.
    (current) => calendarUntil(current, oneWeek),
    (current) =>
      current.strategy
        ? {
            ...current,
            strategy: {
              ...current.strategy,
              calendar: (current.strategy.calendar ?? []).map((entry) =>
                shortEntry(entry as Record<string, unknown>),
              ),
            },
          }
        : current,
    (current) => calendarUntil(current, soon),
    (current) => without(current, "strategy", ["calendar"]),
  ];
  let fitted = context;
  for (const step of steps) {
    if (Buffer.byteLength(JSON.stringify(fitted)) <= budget) break;
    fitted = step(fitted);
  }
  return fitted;
}

function shortEntry(piece: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    SHORT_ENTRY_KEYS.filter((key) => key in piece).map((key) => [
      key,
      piece[key],
    ]),
  );
}

/** The calendar up to a day; the rest stays stored. */
function calendarUntil(
  current: MarketingContext,
  lastDay: string,
): MarketingContext {
  if (!current.strategy) return current;
  return {
    ...current,
    strategy: {
      ...current.strategy,
      calendar: (current.strategy.calendar ?? []).filter(
        (entry) =>
          (entry as { date?: string }).date === undefined ||
          (entry as { date: string }).date <= lastDay,
      ),
    },
  };
}

/** The last day a turn sees full drafts for. */
export function draftHorizon(now: Date): string {
  return new Date(now.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
}

function day(at: Date, offset = 0): string {
  return new Date(at.getTime() + offset * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/**
 * The seven days before today (Monday to Sunday on the review's Monday), and
 * the day after, for an exclusive bound.
 */
export function cmoLastWeek(now: Date): {
  from: string;
  to: string;
  until: string;
} {
  return { from: day(now, -7), to: day(now, -1), until: day(now) };
}

/** The packet appended to a CMO rhythm's prompt. */
export async function buildCmoBeatPacket(
  sokoBotId: string,
  now: Date,
  key: CmoSystemSchedule["key"],
): Promise<{ packet: string; skip: boolean }> {
  const cuso = await findCusoForBot(sokoBotId);
  if (!cuso) return { packet: "", skip: true };
  // Nothing runs without a reason: no approved strategy, no Brand Brain,
  // or not the reminder's one slot. A skipped run costs no turn.
  const [approved, newest] = await Promise.all([
    approvedMarketingStrategy(cuso.projectId),
    newestMarketingStrategy(cuso.projectId),
  ]);
  const skipReason = cmoRoutineSkipReason(key, {
    brandBrain: parseBrandBrain(cuso.brandBrain) !== null,
    strategySavedAt: newest?.updatedAt ?? null,
    strategyApproved: approved !== null,
    now,
  });
  if (skipReason) return { packet: "", skip: true };
  // A rhythm carries out the approved version, never a draft.
  const sources = await readCmoContextSources(sokoBotId, now, {
    executing: true,
  });
  if (!sources) return { packet: "", skip: true };
  const approvedShown = sources.strategyVersion?.approvedAt != null;
  const onDemand = cmoReadsOnDemand(
    getSokoBotVersion(sources.versionId).skills,
  );
  // The weekly review measures the seven days before today, and only what
  // went out in them: listed by change date, December's drafts looked like
  // last week to entry.fyi's review of 23 November.
  const lastWeek = key === "cmo-weekly-review" ? cmoLastWeek(now) : null;
  const posts = cuso
    ? await prisma.socialPost.findMany({
        where: {
          projectId: cuso.projectId,
          ...(lastWeek
            ? {
                status: "PUBLISHED",
                publishedAt: {
                  gte: new Date(`${lastWeek.from}T00:00:00Z`),
                  lt: new Date(`${lastWeek.until}T00:00:00Z`),
                },
              }
            : {
                updatedAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
              }),
        },
        orderBy: lastWeek ? { publishedAt: "asc" } : { updatedAt: "desc" },
        take: lastWeek ? 100 : 20,
        select: {
          id: true,
          provider: true,
          status: true,
          scheduledAt: true,
          publishedAt: true,
          publishedUrl: true,
          text: true,
        },
      })
    : [];
  const lines = [
    `## Execution: ${
      !approvedShown
        ? "waiting for the owner to approve the strategy (draft only)"
        : sources.subscriptionActive
          ? "active"
          : "paused: no CMO subscription (draft only)"
    }`,
    `## Connected channels: ${JSON.stringify(cmoConnectedChannelsContext(sources.channels))}`,
    "",
    // Every turn's context already carries both in full; repeating them here
    // pushed a full four-week plan past the 20,000-character message limit.
    onDemand
      ? "## Brand Brain and strategy: workspace.marketing in your context holds the core, its map and what this run needs. Read the rest with read_calendar, read_strategy, read_brand_brain and read_report."
      : "## Brand Brain and strategy: workspace.marketing in your context. Its calendar is the next 31 days; entries outside that window stay when you save_strategy.",
    "",
    ...(lastWeek
      ? [
          `## Today: ${day(now)}. Last week: ${lastWeek.from} to ${lastWeek.to}. Measure only these seven days: ask every source (list_social_post_statistics, analytics, Search Console) for exactly this range.`,
          "",
          `## Social posts published last week (${lastWeek.from} to ${lastWeek.to})`,
        ]
      : ["## Social posts, last 14 days"]),
    ...(posts.length
      ? posts.map(
          (post) =>
            `- ${post.status} · ${post.provider} · ${post.scheduledAt?.toISOString() ?? post.publishedAt?.toISOString() ?? "unscheduled"} · "${post.text.replace(/\s+/g, " ").slice(0, 80)}" (id ${post.id})${post.publishedUrl ? ` ${post.publishedUrl}` : ""}`,
        )
      : ["- none"]),
  ];
  return { packet: lines.join("\n"), skip: false };
}
