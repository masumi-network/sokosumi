import { Prisma } from "@sokosumi/database";

import { z } from "zod";
import type { KeywordIdea } from "@/lib/ads/dataforseo";
import prisma from "@/lib/db/prisma";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import {
  GSC_STATS_TOOL,
  searchConsoleSettledEnd,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import { SEO_OPPORTUNITY_RULES } from "@/lib/seo/search-opportunities";
import {
  type CmoKeywordIdea,
  type CmoKeywordSearch,
  type CmoSearchConsole,
} from "@/schemas/cmo-seo.schema";
import { CmoConflictError, type Cuso } from "@/services/cmo-cuso.service";
import { testCopySourceBotId } from "@/services/cmo-test-copy.service";
import {
  type ComposioIntegrationAccount,
  composioEntityId,
} from "@/services/composio-integration-tools.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "@/services/project-seo-statistics.service";
import { normalizeSeoUrl } from "@/services/project-seo-store";
import { resolveProvider } from "@/services/soko-bot-integrations.service";
import {
  KEYWORD_EVIDENCE_MS,
  keywordSearchPayloadSchema,
} from "./cmo-keyword-evidence";
import {
  CMO_KEYWORD_SEARCHES_PER_DAY,
  keywordRunTotals,
  reserveKeywordRun,
} from "./cmo-keyword-purchases";
import { researchKeywordRun } from "./cmo-keyword-research-run";
import { latestCmoSeoAudit } from "./cmo-seo-audit.service";
import { cmoSeoMarket } from "./cmo-seo-market";

export {
  CMO_KEYWORD_SEARCHES_PER_DAY,
  keywordSearchesLeft,
} from "./cmo-keyword-purchases";

const DAY_MS = 86_400_000;
/** Keyword volumes are monthly: a search for the same topic is read again after a week. */
const KEYWORD_CACHE_MS = 7 * DAY_MS;

/** Search Console is read again after a day; its final data trails by about three days. */
const SEARCH_CONSOLE_CACHE_MS = DAY_MS;
const SEARCH_CONSOLE_DAYS = 28;
const SEARCH_CONSOLE_ROWS = 250;
const OPPORTUNITIES_SHOWN = 10;
const SEARCH_CONSOLE_KEY = "latest";
const GSC_PROVIDER = "google_search_console";
export const normalizeKeyword = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

const searchRowSchema = z.object({
  query: z.string(),
  pageUrl: z.string(),
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
});
type SearchRow = z.infer<typeof searchRowSchema>;
const totalsSchema = z.object({
  clicks: z.number(),
  impressions: z.number(),
  ctr: z.number().nullable(),
  position: z.number().nullable(),
});
type Totals = z.infer<typeof totalsSchema>;

/** Clicks, impressions, click rate and impression-weighted position of daily rows. */
export function totalsOf(
  rows: { clicks: number; impressions: number; position?: number | null }[],
): Totals {
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  const weighted = rows.reduce(
    (sum, row) => sum + (row.position ?? 0) * row.impressions,
    0,
  );
  return {
    clicks,
    impressions,
    ctr: impressions ? clicks / impressions : null,
    position: impressions ? weighted / impressions : null,
  };
}

const searchConsolePayloadSchema = z.object({
  property: z.string(),
  from: z.string(),
  to: z.string(),
  totals: totalsSchema,
  rows: z.array(searchRowSchema),
  /** The 28 days before `from`; missing on payloads stored before it was read. */
  previousTotals: totalsSchema.nullable().optional(),
});
type SearchConsolePayload = z.infer<typeof searchConsolePayloadSchema>;

const gscRowsSchema = z.object({
  rows: z
    .array(
      z.object({
        keys: z.array(z.string()).default([]),
        clicks: z.number(),
        impressions: z.number(),
        ctr: z.number().nullish(),
        position: z.number().nullish(),
      }),
    )
    .default([]),
});

// ---------------------------------------------------------------------------
// Search Console, through Cuso's own connection
// ---------------------------------------------------------------------------

export async function searchConsoleAccount(
  cusoBotId: string,
): Promise<ComposioIntegrationAccount | null> {
  // A test copy reads its source's Search Console (ADR 0073).
  const sokoBotId = (await testCopySourceBotId(cusoBotId)) ?? cusoBotId;
  const row = await prisma.sokoBotIntegration.findUnique({
    where: { sokoBotId_provider: { sokoBotId, provider: GSC_PROVIDER } },
    select: { status: true, composioAccountId: true },
  });
  if (row?.status !== "ACTIVE" || !row.composioAccountId) return null;
  return {
    provider: resolveProvider(GSC_PROVIDER),
    composioAccountId: row.composioAccountId,
    entityId: composioEntityId(sokoBotId),
    sokoBotId,
  };
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** The property for the brand's site: a domain property first, then the longest URL prefix. */
export function pickProperty(ids: string[], websiteUrl: string): string | null {
  const covering = ids.filter((id) => gscPropertyCovers(id, [websiteUrl]));
  return (
    covering.find((id) => id.startsWith("sc-domain:")) ??
    covering.sort((a, b) => b.length - a.length)[0] ??
    null
  );
}

async function fetchSearchConsole(
  account: ComposioIntegrationAccount,
  websiteUrl: string,
  now: Date,
): Promise<SearchConsolePayload | "no_property"> {
  const properties = await propertyChoices(account, "search_console");
  const property = pickProperty(
    properties.properties.map((choice) => choice.id),
    normalizeSeoUrl(websiteUrl),
  );
  if (!property) return "no_property";
  const wanted = isoDay(new Date(now.getTime() - DAY_MS));
  const to = searchConsoleSettledEnd(wanted, "0000-00-00", now);
  const from = isoDay(
    new Date(
      Date.parse(`${to}T00:00:00Z`) - (SEARCH_CONSOLE_DAYS - 1) * DAY_MS,
    ),
  );
  const previousFrom = isoDay(
    new Date(Date.parse(`${from}T00:00:00Z`) - SEARCH_CONSOLE_DAYS * DAY_MS),
  );
  const query = (dimensions: string[], rowLimit: number, start = from) =>
    readNativeSeoTool(account, GSC_STATS_TOOL, {
      site_url: property,
      start_date: start,
      end_date: to,
      dimensions,
      search_type: "web",
      data_state: "final",
      row_limit: rowLimit,
      start_row: 0,
    }).then((raw) =>
      gscRowsSchema.parse(unwrapNativeStatistics(raw, ["rows"])),
    );
  const [byQuery, byDate] = await Promise.all([
    query(["query", "page"], SEARCH_CONSOLE_ROWS),
    query(["date"], 2 * SEARCH_CONSOLE_DAYS + 4, previousFrom),
  ]);
  const current = byDate.rows.filter((row) => (row.keys[0] ?? "") >= from);
  const previous = byDate.rows.filter((row) => (row.keys[0] ?? "") < from);
  return {
    property,
    from,
    to,
    totals: totalsOf(current),
    previousTotals: previous.length ? totalsOf(previous) : null,
    rows: byQuery.rows.flatMap((row) =>
      row.keys.length === 2
        ? [
            {
              query: row.keys[0],
              pageUrl: row.keys[1],
              clicks: row.clicks,
              impressions: row.impressions,
              ctr: row.impressions ? (row.ctr ?? null) : null,
              position: row.impressions ? (row.position ?? null) : null,
            },
          ]
        : [],
    ),
  };
}

export async function storedSearchConsole(projectId: string) {
  const row = await prisma.projectSeoResearch.findUnique({
    where: {
      projectId_kind_key: {
        projectId,
        kind: "search_console",
        key: SEARCH_CONSOLE_KEY,
      },
    },
    select: { payload: true, observedAt: true },
  });
  const parsed = row ? searchConsolePayloadSchema.safeParse(row.payload) : null;
  return parsed?.success
    ? { payload: parsed.data, observedAt: row!.observedAt }
    : null;
}

/** Searches ranked 8 to 20, and searches seen near the top but rarely clicked. */
export function searchConsoleOpportunities(rows: SearchRow[]) {
  const rule = SEO_OPPORTUNITY_RULES.snippetReview;
  const byImpressions = [...rows].sort((a, b) => b.impressions - a.impressions);
  return {
    nearFirstPage: byImpressions
      .filter(
        (row) =>
          row.position !== null &&
          row.position >= 8 &&
          row.position <= 20 &&
          row.impressions >= rule.minImpressions,
      )
      .slice(0, OPPORTUNITIES_SHOWN),
    lowClickRate: byImpressions
      .filter(
        (row) =>
          row.position !== null &&
          row.position <= rule.maxAveragePosition &&
          row.ctr !== null &&
          row.ctr < rule.maxCtr &&
          row.impressions >= rule.minImpressions,
      )
      .slice(0, OPPORTUNITIES_SHOWN),
  };
}

/**
 * The brand's Search Console numbers for the last 28 settled days, read from
 * Cuso's own Google connection at most once a day. Without a connection
 * everything else works, with less data.
 */
export async function readCmoSearchConsole(
  cuso: Cuso,
  now: Date = new Date(),
): Promise<CmoSearchConsole> {
  const empty = {
    property: null,
    from: null,
    to: null,
    observedAt: null,
    totals: null,
    previousTotals: null,
    nearFirstPage: [],
    lowClickRate: [],
  };
  const account = await searchConsoleAccount(cuso.sokoBotId);
  if (!account) return { status: "not_connected", ...empty };
  const stored = await storedSearchConsole(cuso.projectId);
  let current = stored;
  if (
    !stored ||
    now.getTime() - stored.observedAt.getTime() > SEARCH_CONSOLE_CACHE_MS
  ) {
    try {
      const fetched = await fetchSearchConsole(account, cuso.websiteUrl, now);
      if (fetched === "no_property") return { status: "no_property", ...empty };
      await prisma.projectSeoResearch.upsert({
        where: {
          projectId_kind_key: {
            projectId: cuso.projectId,
            kind: "search_console",
            key: SEARCH_CONSOLE_KEY,
          },
        },
        create: {
          projectId: cuso.projectId,
          kind: "search_console",
          key: SEARCH_CONSOLE_KEY,
          payload: fetched as Prisma.InputJsonObject,
          observedAt: now,
        },
        update: { payload: fetched as Prisma.InputJsonObject, observedAt: now },
      });
      current = { payload: fetched, observedAt: now };
    } catch {
      if (!stored) return { status: "unavailable", ...empty };
    }
  }
  const { payload, observedAt } = current!;
  return {
    status: "connected",
    property: payload.property,
    from: payload.from,
    to: payload.to,
    observedAt: observedAt.toISOString(),
    totals: payload.totals,
    previousTotals: payload.previousTotals ?? null,
    ...searchConsoleOpportunities(payload.rows),
  };
}

// ---------------------------------------------------------------------------
// Keyword research
// ---------------------------------------------------------------------------

export async function recentKeywordSearches(
  projectId: string,
  take: number,
  market?: { countryCode: string; languageCode: string },
  now?: Date,
) {
  const rows = await prisma.projectSeoResearch.findMany({
    where: {
      projectId,
      kind: "keyword_ideas",
      ...(market && {
        key: { endsWith: `|${market.countryCode}|${market.languageCode}` },
      }),
      ...(now && {
        observedAt: {
          gt: new Date(now.getTime() - KEYWORD_EVIDENCE_MS),
          lte: now,
        },
      }),
    },
    orderBy: [{ observedAt: "desc" }, { id: "desc" }],
    take,
    select: { payload: true, observedAt: true },
  });
  return rows.flatMap((row) => {
    const parsed = keywordSearchPayloadSchema.safeParse(row.payload);
    return parsed.success &&
      (!market ||
        (parsed.data.countryCode === market.countryCode &&
          parsed.data.languageCode === market.languageCode))
      ? [{ ...parsed.data, observedAt: row.observedAt }]
      : [];
  });
}

type SiteSearch = {
  position: number | null;
  positionSource: "search_console" | "weekly_audit" | null;
  impressions: number | null;
  clicks: number | null;
};

/**
 * What the site already knows about each search: Search Console's totals over
 * its pages (position weighted by impressions), else the latest audit's rank.
 */
export async function siteSearchesFor(
  projectId: string,
): Promise<Map<string, SiteSearch>> {
  const [gsc, audit] = await Promise.all([
    storedSearchConsole(projectId),
    latestCmoSeoAudit(projectId),
  ]);
  const searches = new Map<string, SiteSearch>();
  for (const keyword of audit?.payload.keywords ?? [])
    if (keyword.position !== null)
      searches.set(normalizeKeyword(keyword.keyword), {
        position: keyword.position,
        positionSource: "weekly_audit",
        impressions: null,
        clicks: null,
      });
  const totals = new Map<
    string,
    { impressions: number; clicks: number; weighted: number; seen: number }
  >();
  for (const row of gsc?.payload.rows ?? []) {
    const key = normalizeKeyword(row.query);
    const t = totals.get(key) ?? {
      impressions: 0,
      clicks: 0,
      weighted: 0,
      seen: 0,
    };
    t.impressions += row.impressions;
    t.clicks += row.clicks;
    if (row.position !== null) {
      t.weighted += row.position * row.impressions;
      t.seen += row.impressions;
    }
    totals.set(key, t);
  }
  for (const [key, t] of totals)
    searches.set(key, {
      ...(t.seen > 0
        ? {
            position: Math.round((t.weighted / t.seen) * 10) / 10,
            positionSource: "search_console" as const,
          }
        : (searches.get(key) ?? { position: null, positionSource: null })),
      impressions: t.impressions,
      clicks: t.clicks,
    });
  return searches;
}

const STOP_WORDS = new Set(
  "a an and are best by can do for from how i in is it my of on or the to vs what with you your".split(
    " ",
  ),
);

/** A search's content words, roughly stemmed: "minting fees" -> ["mint", "fee"]. */
export function searchWords(text: string): string[] {
  return normalizeKeyword(text)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map((w) => w.replace(/^(.{3,}?)(ing|ed|s)$/, "$1"));
}

const SITE_MATCHES_SHOWN = 10;

/**
 * The topic's ideas with what the site knows about each, then the brand's own
 * Search Console searches that share the topic's words (two, or its one). A
 * niche market often has no measured monthly volume; Google showing the site
 * for a search is then the real number.
 */
export function withSiteSearches(
  topic: string,
  ideas: KeywordIdea[],
  site: Map<string, SiteSearch>,
): CmoKeywordIdea[] {
  const none = {
    position: null,
    positionSource: null,
    impressions: null,
    clicks: null,
  };
  const listed = ideas.map(({ cpc: _cpc, ...idea }) => ({
    ...idea,
    ...(site.get(normalizeKeyword(idea.keyword)) ?? none),
  }));
  const taken = new Set(listed.map((i) => normalizeKeyword(i.keyword)));
  const words = new Set(searchWords(topic));
  const needed = Math.min(2, words.size);
  const matches = needed
    ? [...site]
        .filter(([query, s]) => !taken.has(query) && (s.impressions ?? 0) > 0)
        .map(([query, s]) => ({
          query,
          s,
          shared: new Set(searchWords(query).filter((w) => words.has(w))).size,
        }))
        .filter((m) => m.shared >= needed)
        .sort(
          (a, b) =>
            b.shared - a.shared ||
            (b.s.impressions ?? 0) - (a.s.impressions ?? 0),
        )
        .slice(0, SITE_MATCHES_SHOWN)
        .map(
          ({ query, s }): CmoKeywordIdea => ({
            keyword: query,
            searchVolume: null,
            difficulty: null,
            intent: null,
            ...s,
          }),
        )
    : [];
  const measured = listed.filter((i) => i.searchVolume !== null);
  const unmeasured = listed.filter((i) => i.searchVolume === null);
  return [...measured, ...matches, ...unmeasured];
}

/**
 * Keyword ideas for a topic in the brand's market: monthly searches,
 * difficulty, intent, and where the site ranks today. The same topic is read
 * again after a week. The SEO tab and Cuso use this one path.
 */
export async function searchCmoKeywords(
  cuso: Cuso,
  rawTopic: string,
  now: Date = new Date(),
): Promise<CmoKeywordSearch> {
  const topic = normalizeKeyword(rawTopic);
  if (topic.length < 2 || topic.length > 80)
    throw new CmoConflictError("Type a topic of 2 to 80 characters");
  const market = await cmoSeoMarket(cuso);
  const key = `${topic}|${market.countryCode}|${market.languageCode}`;
  const admission = await reserveKeywordRun(
    cuso.projectId,
    key,
    now,
    KEYWORD_CACHE_MS,
    (payload) => keywordSearchPayloadSchema.safeParse(payload).success,
  );
  let ideas: KeywordIdea[];
  let observedAt: Date;
  if (admission.cached) {
    ideas = keywordSearchPayloadSchema.parse(admission.cached.payload).ideas;
    observedAt = admission.cached.observedAt;
  } else {
    const runId = admission.runId;
    try {
      const parsed = admission.previous
        ? keywordSearchPayloadSchema.safeParse(admission.previous.payload)
        : null;
      const previous =
        parsed?.success &&
        parsed.data.topic === topic &&
        parsed.data.countryCode === market.countryCode &&
        parsed.data.languageCode === market.languageCode &&
        admission.previous
          ? { ...parsed.data, observedAt: admission.previous.observedAt }
          : undefined;
      const history = await recentKeywordSearches(
        cuso.projectId,
        CMO_KEYWORD_SEARCHES_PER_DAY,
        market,
        now,
      );
      const payload = await researchKeywordRun(
        cuso,
        runId,
        topic,
        rawTopic,
        market,
        now,
        previous,
        history,
      );
      ideas = payload.ideas;
      observedAt = now;
      const totals = await keywordRunTotals(cuso.projectId, runId);
      await prisma.$transaction([
        prisma.projectSeoResearch.upsert({
          where: {
            projectId_kind_key: {
              projectId: cuso.projectId,
              kind: "keyword_ideas",
              key,
            },
          },
          create: {
            projectId: cuso.projectId,
            kind: "keyword_ideas",
            key,
            payload,
            observedAt,
          },
          update: { payload, observedAt },
        }),
        prisma.projectSeoResearch.update({
          where: { id: runId },
          data: {
            payload: {
              status: "complete",
              ...totals,
            },
          },
        }),
      ]);
    } catch (error) {
      await prisma.projectSeoResearch.update({
        where: { id: runId },
        data: {
          payload: {
            status: "failed",
            ...(await keywordRunTotals(cuso.projectId, runId)),
          },
        },
      });
      throw error;
    }
  }
  return {
    topic,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    observedAt: observedAt.toISOString(),
    ideas: withSiteSearches(
      topic,
      ideas,
      await siteSearchesFor(cuso.projectId),
    ),
  };
}
