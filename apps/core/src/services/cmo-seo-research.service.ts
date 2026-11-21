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
const searchConsolePayloadSchema = z.object({
  property: z.string(),
  from: z.string(),
  to: z.string(),
  totals: z.object({
    clicks: z.number(),
    impressions: z.number(),
    ctr: z.number().nullable(),
    position: z.number().nullable(),
  }),
  rows: z.array(searchRowSchema),
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

async function searchConsoleAccount(
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
function pickProperty(ids: string[], websiteUrl: string): string | null {
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
  const query = (dimensions: string[], rowLimit: number) =>
    readNativeSeoTool(account, GSC_STATS_TOOL, {
      site_url: property,
      start_date: from,
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
    query(["date"], SEARCH_CONSOLE_DAYS + 2),
  ]);
  const clicks = byDate.rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = byDate.rows.reduce(
    (sum, row) => sum + row.impressions,
    0,
  );
  const weighted = byDate.rows.reduce(
    (sum, row) => sum + (row.position ?? 0) * row.impressions,
    0,
  );
  return {
    property,
    from,
    to,
    totals: {
      clicks,
      impressions,
      ctr: impressions ? clicks / impressions : null,
      position: impressions ? weighted / impressions : null,
    },
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

/** Where the site ranks for each keyword: Search Console's average first, else the latest audit's read. */
export async function positionsFor(projectId: string) {
  const [gsc, audit] = await Promise.all([
    storedSearchConsole(projectId),
    latestCmoSeoAudit(projectId),
  ]);
  const positions = new Map<
    string,
    { position: number; source: "search_console" | "weekly_audit" }
  >();
  for (const keyword of audit?.payload.keywords ?? [])
    if (keyword.position !== null)
      positions.set(normalizeKeyword(keyword.keyword), {
        position: keyword.position,
        source: "weekly_audit",
      });
  for (const row of gsc?.payload.rows ?? [])
    if (row.position !== null)
      positions.set(normalizeKeyword(row.query), {
        position: Math.round(row.position * 10) / 10,
        source: "search_console",
      });
  return positions;
}

export function withPositions(
  ideas: KeywordIdea[],
  positions: Awaited<ReturnType<typeof positionsFor>>,
): CmoKeywordIdea[] {
  return ideas.map(({ cpc: _cpc, ...idea }) => {
    const found = positions.get(normalizeKeyword(idea.keyword));
    return {
      ...idea,
      position: found?.position ?? null,
      positionSource: found?.source ?? null,
    };
  });
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
    ideas: withPositions(ideas, await positionsFor(cuso.projectId)),
  };
}
