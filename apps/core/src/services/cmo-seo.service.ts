import { createHash } from "node:crypto";
import type { Prisma } from "@sokosumi/database";
import { z } from "zod";
import { fetchKeywordIdeas, type KeywordIdea } from "@/lib/ads/dataforseo";
import prisma from "@/lib/db/prisma";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import {
  GSC_STATS_TOOL,
  searchConsoleSettledEnd,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import { SEO_OPPORTUNITY_RULES } from "@/lib/seo/search-opportunities";
import type { PresetRoute } from "@/lib/soko-bot/classifier";
import {
  type CmoKeywordIdea,
  type CmoKeywordSearch,
  type CmoSearchConsole,
  type CmoSeo,
  type CmoSeoEvidence,
  type CmoSeoSuggestion,
  cmoSeoEvidenceSchema,
} from "@/schemas/cmo-seo.schema";
import {
  CmoConflictError,
  CmoNotFoundError,
  type Cuso,
  type CusoTarget,
  requireCuso,
  startCmoTurn,
} from "@/services/cmo-cuso.service";
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
  auditSuggestionKey,
  latestCmoSeoAudit,
  readCmoSeoAudit,
} from "./cmo-seo-audit.service";
import { cmoSeoMarket } from "./cmo-seo-market";

const DAY_MS = 86_400_000;
/** Keyword volumes are monthly: a search for the same topic is read again after a week. */
const KEYWORD_CACHE_MS = 7 * DAY_MS;
/** New keyword reads a Project may make a day (each one costs a few cents). */
export const CMO_KEYWORD_SEARCHES_PER_DAY = 25;
const KEYWORD_SEARCHES_SHOWN = 3;
/** Search Console is read again after a day; its final data trails by about three days. */
const SEARCH_CONSOLE_CACHE_MS = DAY_MS;
const SEARCH_CONSOLE_DAYS = 28;
const SEARCH_CONSOLE_ROWS = 250;
const OPPORTUNITIES_SHOWN = 10;
const SEARCH_CONSOLE_KEY = "latest";
const GSC_PROVIDER = "google_search_console";
export const CMO_SEO_SUGGESTIONS_PER_SAVE = 5;
const OPEN_SUGGESTIONS_MAX = 30;

const CMO_SEO_ROUTE: PresetRoute = {
  route: "MANAGE_WORK",
  writeScope: "WORK",
  reason: "CMO SEO: article ideas and drafts from real search data.",
};

const normalizeKeyword = (value: string) =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

const keywordSearchPayloadSchema = z.object({
  topic: z.string(),
  countryCode: z.string(),
  languageCode: z.string(),
  ideas: z.array(
    z.object({
      keyword: z.string(),
      searchVolume: z.number().nullable(),
      difficulty: z.number().nullable(),
      intent: z
        .enum(["informational", "navigational", "commercial", "transactional"])
        .nullable(),
      cpc: z.number().nullable(),
    }),
  ),
});

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
  sokoBotId: string,
): Promise<ComposioIntegrationAccount | null> {
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

async function storedSearchConsole(projectId: string) {
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

async function recentKeywordSearches(projectId: string, take: number) {
  const rows = await prisma.projectSeoResearch.findMany({
    where: { projectId, kind: "keyword_ideas" },
    orderBy: { observedAt: "desc" },
    take,
    select: { payload: true, observedAt: true },
  });
  return rows.flatMap((row) => {
    const parsed = keywordSearchPayloadSchema.safeParse(row.payload);
    return parsed.success
      ? [{ ...parsed.data, observedAt: row.observedAt }]
      : [];
  });
}

/** Where the site ranks for each keyword: Search Console's average first, else the latest audit's read. */
async function positionsFor(projectId: string) {
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

function withPositions(
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

export async function keywordSearchesLeft(
  projectId: string,
  now: Date = new Date(),
): Promise<number> {
  const today = new Date(`${isoDay(now)}T00:00:00Z`);
  const used = await prisma.projectSeoResearch.count({
    where: { projectId, kind: "keyword_ideas", observedAt: { gte: today } },
  });
  return Math.max(0, CMO_KEYWORD_SEARCHES_PER_DAY - used);
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
  const cached = await prisma.projectSeoResearch.findUnique({
    where: {
      projectId_kind_key: {
        projectId: cuso.projectId,
        kind: "keyword_ideas",
        key,
      },
    },
    select: { payload: true, observedAt: true },
  });
  const fresh =
    cached && now.getTime() - cached.observedAt.getTime() < KEYWORD_CACHE_MS
      ? keywordSearchPayloadSchema.safeParse(cached.payload)
      : null;
  let ideas: KeywordIdea[];
  let observedAt: Date;
  if (fresh?.success) {
    ideas = fresh.data.ideas;
    observedAt = cached!.observedAt;
  } else {
    if ((await keywordSearchesLeft(cuso.projectId, now)) === 0)
      throw new CmoConflictError(
        `That was today's last keyword search (${CMO_KEYWORD_SEARCHES_PER_DAY} a day). Try again tomorrow.`,
      );
    ideas = await fetchKeywordIdeas({
      topic,
      locationCode: market.locationCode,
      languageCode: market.languageCode,
    });
    observedAt = now;
    const payload = {
      topic,
      countryCode: market.countryCode,
      languageCode: market.languageCode,
      ideas,
    };
    await prisma.projectSeoResearch.upsert({
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
    });
  }
  return {
    topic,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    observedAt: observedAt.toISOString(),
    ideas: withPositions(ideas, await positionsFor(cuso.projectId)),
  };
}

// ---------------------------------------------------------------------------
// Suggestions: articles and page changes
// ---------------------------------------------------------------------------

const intOf = (value: number) => Math.round(value).toLocaleString("en-US");

/** The measured numbers for a keyword, each with its source and date. */
async function keywordEvidence(
  projectId: string,
  keyword: string,
): Promise<CmoSeoEvidence[]> {
  const wanted = normalizeKeyword(keyword);
  const [searches, audit, gsc] = await Promise.all([
    recentKeywordSearches(projectId, 30),
    latestCmoSeoAudit(projectId),
    storedSearchConsole(projectId),
  ]);
  const evidence: CmoSeoEvidence[] = [];
  const base = { keyword, pageUrl: null };
  const idea = searches
    .flatMap((search) =>
      search.ideas.map((item) => ({ item, observedAt: search.observedAt })),
    )
    .find(({ item }) => normalizeKeyword(item.keyword) === wanted);
  if (idea) {
    const at = idea.observedAt.toISOString();
    if (idea.item.searchVolume !== null)
      evidence.push({
        ...base,
        metric: "searchVolume",
        value: intOf(idea.item.searchVolume),
        source: "keyword_research",
        observedAt: at,
      });
    if (idea.item.difficulty !== null)
      evidence.push({
        ...base,
        metric: "difficulty",
        value: String(idea.item.difficulty),
        source: "keyword_research",
        observedAt: at,
      });
    if (idea.item.intent)
      evidence.push({
        ...base,
        metric: "intent",
        value: idea.item.intent,
        source: "keyword_research",
        observedAt: at,
      });
  }
  const audited = audit?.payload.keywords.find(
    (item) => normalizeKeyword(item.keyword) === wanted,
  );
  if (audit && audited) {
    const at = audit.observedAt.toISOString();
    if (!idea && audited.volume != null)
      evidence.push({
        ...base,
        metric: "searchVolume",
        value: intOf(audited.volume),
        source: "weekly_audit",
        observedAt: at,
      });
    evidence.push({
      ...base,
      metric: "position",
      value:
        audited.position !== null
          ? String(audited.position)
          : `not in the top ${audited.checkedResults ?? 10}`,
      source: "weekly_audit",
      observedAt: at,
    });
  }
  const rows = (gsc?.payload.rows ?? []).filter(
    (row) => normalizeKeyword(row.query) === wanted,
  );
  if (gsc && rows.length) {
    const at = gsc.observedAt.toISOString();
    const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
    const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
    const best = Math.min(...rows.map((row) => row.position ?? Infinity));
    evidence.push(
      {
        ...base,
        metric: "impressions",
        value: intOf(impressions),
        source: "search_console",
        observedAt: at,
      },
      {
        ...base,
        metric: "clicks",
        value: intOf(clicks),
        source: "search_console",
        observedAt: at,
      },
    );
    if (Number.isFinite(best))
      evidence.push({
        ...base,
        metric: "position",
        value: best.toFixed(1),
        source: "search_console",
        observedAt: at,
      });
  }
  return evidence;
}

/** The measured numbers for one page: its Search Console searches and the audit's issues on it. */
async function pageEvidence(
  projectId: string,
  pageUrl: string,
): Promise<CmoSeoEvidence[]> {
  const page = normalizeSeoUrl(pageUrl);
  const [audit, gsc] = await Promise.all([
    latestCmoSeoAudit(projectId),
    storedSearchConsole(projectId),
  ]);
  const evidence: CmoSeoEvidence[] = [];
  const rows = (gsc?.payload.rows ?? [])
    .filter((row) => normalizeSeoUrl(row.pageUrl) === page)
    .sort((a, b) => b.impressions - a.impressions);
  if (gsc && rows[0]) {
    const at = gsc.observedAt.toISOString();
    const top = rows[0];
    const base = { keyword: top.query, pageUrl };
    evidence.push(
      {
        ...base,
        metric: "impressions",
        value: intOf(top.impressions),
        source: "search_console",
        observedAt: at,
      },
      {
        ...base,
        metric: "clicks",
        value: intOf(top.clicks),
        source: "search_console",
        observedAt: at,
      },
    );
    if (top.position !== null)
      evidence.push({
        ...base,
        metric: "position",
        value: top.position.toFixed(1),
        source: "search_console",
        observedAt: at,
      });
    if (top.ctr !== null)
      evidence.push({
        ...base,
        metric: "ctr",
        value: `${(top.ctr * 100).toFixed(1)}%`,
        source: "search_console",
        observedAt: at,
      });
  }
  const findings = (audit?.payload.findings ?? []).filter(
    (finding) =>
      normalizeSeoUrl(finding.pageUrl) === page &&
      ["critical", "major", "minor"].includes(finding.severity),
  );
  for (const finding of new Map(findings.map((f) => [f.rowId, f])).values())
    evidence.push({
      metric: "auditIssue",
      keyword: null,
      pageUrl,
      value: finding.title,
      source: "weekly_audit",
      observedAt: audit!.observedAt.toISOString(),
    });
  return evidence.slice(0, 8);
}

/** The latest audit's own fixes, as page changes on the to-do list. Made once each. */
async function seedAuditPageChanges(projectId: string): Promise<void> {
  const audit = await latestCmoSeoAudit(projectId);
  if (!audit) return;
  const at = audit.observedAt.toISOString();
  for (const action of audit.payload.actions) {
    const rowIds = action.findingIds.map((id) => id.split(":")[0]);
    const key = auditSuggestionKey(action.pageUrl, rowIds);
    const findings = audit.payload.findings.filter(
      (finding) =>
        rowIds.includes(finding.rowId) &&
        normalizeSeoUrl(finding.pageUrl) === normalizeSeoUrl(action.pageUrl),
    );
    const evidence: CmoSeoEvidence[] = [
      ...new Map(findings.map((f) => [f.rowId, f])).values(),
    ].map((finding) => ({
      metric: "auditIssue",
      keyword: null,
      pageUrl: action.pageUrl,
      value: finding.title,
      source: "weekly_audit",
      observedAt: at,
    }));
    await prisma.projectSeoSuggestion.upsert({
      where: { projectId_key: { projectId, key } },
      create: {
        projectId,
        kind: "page_change",
        key,
        source: "audit",
        observationId: audit.id,
        title: action.title,
        pageUrl: action.pageUrl,
        why: action.why,
        body: action.edit
          ? `Change the ${action.edit.target}${action.edit.before ? ` from "${action.edit.before}"` : ""}.`
          : action.expectedEffect,
        newText: action.edit?.after ?? null,
        evidence,
      },
      update: {},
    });
  }
}

function toSuggestion(
  row: Prisma.ProjectSeoSuggestionGetPayload<object>,
): CmoSeoSuggestion {
  const evidence = z.array(cmoSeoEvidenceSchema).safeParse(row.evidence);
  return {
    id: row.id,
    kind: row.kind === "article" ? "article" : "page_change",
    source: row.source === "audit" ? "audit" : "cuso",
    title: row.title,
    keyword: row.keyword,
    pageUrl: row.pageUrl,
    why: row.why,
    body: row.body,
    newText: row.newText,
    draft: row.draft,
    evidence: evidence.success ? evidence.data : [],
    status: (["open", "done", "verified", "dismissed"] as const).find(
      (status) => status === row.status,
    )!,
    createdAt: row.createdAt.toISOString(),
    doneAt: row.doneAt?.toISOString() ?? null,
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
  };
}

export const cmoSeoArticleInputSchema = z.object({
  id: z.string().uuid().optional(),
  title: z.string().trim().min(5).max(160),
  keyword: z.string().trim().min(2).max(80),
  why: z.string().trim().min(10).max(600),
  outline: z.string().trim().min(10).max(4000),
  draft: z.string().trim().min(200).max(40_000).optional(),
});
export const cmoSeoPageChangeInputSchema = z.object({
  id: z.string().uuid().optional(),
  pageUrl: z.string().url().max(500),
  title: z.string().trim().min(5).max(160),
  change: z.string().trim().min(10).max(2000),
  newText: z.string().trim().min(2).max(2000),
  why: z.string().trim().min(10).max(600),
  keyword: z.string().trim().min(2).max(80).optional(),
});

function sameHost(url: string, websiteUrl: string): boolean {
  const host = (value: string) =>
    new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  return (
    URL.canParse(url) &&
    URL.canParse(websiteUrl) &&
    host(url) === host(websiteUrl)
  );
}

/**
 * Saves Cuso's articles and page changes. Core attaches the measured numbers
 * itself and refuses a suggestion it has no numbers for, so no number on the
 * SEO tab is ever one Cuso made up.
 */
export async function saveCmoSeoSuggestions(
  cuso: Cuso,
  input: {
    articles?: z.infer<typeof cmoSeoArticleInputSchema>[];
    pageChanges?: z.infer<typeof cmoSeoPageChangeInputSchema>[];
  },
): Promise<{ saved: Array<{ id: string; title: string }>; refused: string[] }> {
  const articles = input.articles ?? [];
  const pageChanges = input.pageChanges ?? [];
  if (articles.length + pageChanges.length > CMO_SEO_SUGGESTIONS_PER_SAVE)
    throw new CmoConflictError(
      `Save at most ${CMO_SEO_SUGGESTIONS_PER_SAVE} suggestions at once.`,
    );
  const open = await prisma.projectSeoSuggestion.count({
    where: { projectId: cuso.projectId, status: "open" },
  });
  const saved: Array<{ id: string; title: string }> = [];
  const refused: string[] = [];
  const existing = async (id: string | undefined, kind: string) =>
    id
      ? prisma.projectSeoSuggestion.findFirst({
          where: { id, projectId: cuso.projectId, kind },
          select: { id: true },
        })
      : null;
  for (const article of articles) {
    const evidence = await keywordEvidence(cuso.projectId, article.keyword);
    if (!evidence.some((item) => item.metric !== "intent")) {
      refused.push(
        `"${article.title}": no measured data for "${article.keyword}". Run research_keywords on its topic first, then use a keyword it returned.`,
      );
      continue;
    }
    const data = {
      title: article.title,
      keyword: article.keyword,
      why: article.why,
      body: article.outline,
      evidence,
      ...(article.draft ? { draft: article.draft } : {}),
    };
    const update = await existing(article.id, "article");
    if (!update && open + saved.length >= OPEN_SUGGESTIONS_MAX) {
      refused.push(
        `"${article.title}": the list already holds ${OPEN_SUGGESTIONS_MAX} open suggestions.`,
      );
      continue;
    }
    const key = `article:${normalizeKeyword(article.keyword)}`;
    const row = update
      ? await prisma.projectSeoSuggestion.update({
          where: { id: update.id },
          data,
        })
      : await prisma.projectSeoSuggestion.upsert({
          where: { projectId_key: { projectId: cuso.projectId, key } },
          create: {
            projectId: cuso.projectId,
            kind: "article",
            key,
            source: "cuso",
            ...data,
          },
          update: data,
        });
    saved.push({ id: row.id, title: row.title });
  }
  for (const change of pageChanges) {
    if (!sameHost(change.pageUrl, cuso.websiteUrl)) {
      refused.push(
        `"${change.title}": ${change.pageUrl} is not on ${cuso.websiteUrl}.`,
      );
      continue;
    }
    const evidence = [
      ...(await pageEvidence(cuso.projectId, change.pageUrl)),
      ...(change.keyword
        ? await keywordEvidence(cuso.projectId, change.keyword)
        : []),
    ];
    if (evidence.length === 0) {
      refused.push(
        `"${change.title}": no measured data for ${change.pageUrl} yet (no Search Console rows and no audit issue). Pick a page from read_seo.`,
      );
      continue;
    }
    const data = {
      pageUrl: change.pageUrl,
      title: change.title,
      body: change.change,
      newText: change.newText,
      why: change.why,
      keyword: change.keyword ?? null,
      evidence,
    };
    const update = await existing(change.id, "page_change");
    const key = `page:${normalizeSeoUrl(change.pageUrl)}:${hash(normalizeKeyword(change.title))}`;
    const row = update
      ? await prisma.projectSeoSuggestion.update({
          where: { id: update.id },
          data,
        })
      : await prisma.projectSeoSuggestion.upsert({
          where: { projectId_key: { projectId: cuso.projectId, key } },
          create: {
            projectId: cuso.projectId,
            kind: "page_change",
            key,
            source: "cuso",
            ...data,
          },
          update: data,
        });
    saved.push({ id: row.id, title: row.title });
  }
  return { saved, refused };
}

export async function setCmoSeoSuggestionStatus(
  target: CusoTarget,
  id: string,
  status: "open" | "done" | "dismissed",
  now: Date = new Date(),
): Promise<CmoSeoSuggestion> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId },
  });
  if (!row) throw new CmoNotFoundError("Suggestion not found");
  return toSuggestion(
    await prisma.projectSeoSuggestion.update({
      where: { id },
      data: {
        status,
        doneAt: status === "done" ? now : null,
        checkedAt: null,
        verifiedAt: null,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export async function readCmoSeo(
  target: CusoTarget | Cuso,
  now: Date = new Date(),
): Promise<CmoSeo> {
  const cuso = "sokoBotId" in target ? target : await requireCuso(target);
  await seedAuditPageChanges(cuso.projectId);
  const [market, audit, searchConsole, suggestions, searches, left] =
    await Promise.all([
      cmoSeoMarket(cuso),
      readCmoSeoAudit(cuso),
      readCmoSearchConsole(cuso, now),
      prisma.projectSeoSuggestion.findMany({
        where: { projectId: cuso.projectId, status: { not: "dismissed" } },
        orderBy: [{ createdAt: "desc" }],
        take: 100,
      }),
      recentKeywordSearches(cuso.projectId, KEYWORD_SEARCHES_SHOWN),
      keywordSearchesLeft(cuso.projectId, now),
    ]);
  const positions = await positionsFor(cuso.projectId);
  const all = suggestions.map(toSuggestion);
  return {
    websiteUrl: cuso.websiteUrl,
    countryCode: market.countryCode,
    languageCode: market.languageCode,
    audit,
    searchConsole,
    articles: all.filter((item) => item.kind === "article"),
    pageChanges: all.filter((item) => item.kind === "page_change"),
    keywordSearches: searches.map((search) => ({
      topic: search.topic,
      countryCode: search.countryCode,
      languageCode: search.languageCode,
      observedAt: search.observedAt.toISOString(),
      ideas: withPositions(search.ideas, positions),
    })),
    keywordSearchesLeft: left,
  };
}

/** "More article ideas": Cuso researches and saves new articles; his answer lands in the chat. */
export async function requestCmoArticleIdeas(
  target: CusoTarget,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  return startCmoTurn(cuso, target.userId, {
    clientTurnId: `cmo:seo-ideas:${cuso.sokoBotId}:${Date.now()}`,
    message: [
      `The owner asked for more article ideas for ${cuso.businessName}'s website (SEO tab).`,
      "Call read_seo, then research_keywords on two or three topics the Brand Brain says buyers search for and the site does not cover yet. Pick three keywords with real searches, a difficulty the site can win and the intent of a future customer, and that no open article already targets.",
      "Save them with save_seo_suggestions as articles: title, keyword exactly as research_keywords returned it, why (the numbers and the business reason) and an outline. Do not write the full text now.",
      "Then answer in two short sentences: what you added and why.",
    ].join("\n"),
    route: CMO_SEO_ROUTE,
  });
}

/** "Write the article": Cuso writes the full draft of one suggestion. */
export async function requestCmoArticleDraft(
  target: CusoTarget,
  id: string,
): Promise<{ turnId: string }> {
  const cuso = await requireCuso(target);
  const row = await prisma.projectSeoSuggestion.findFirst({
    where: { id, projectId: cuso.projectId, kind: "article" },
  });
  if (!row) throw new CmoNotFoundError("Article not found");
  return startCmoTurn(cuso, target.userId, {
    clientTurnId: `cmo:seo-draft:${id}:${Date.now()}`,
    message: [
      `The owner asked you to write the article "${row.title}" in full (SEO tab, suggestion ${row.id}).`,
      `Target keyword: ${row.keyword}. Outline:\n${row.body}`,
      "Read the seo writing skill first and follow it. Use only facts from the Brand Brain and the site. Save it with save_seo_suggestions: the same id, title, keyword, why and outline, and the whole article in Markdown as draft.",
      "Then answer in one short sentence that the draft is ready in the SEO tab.",
    ].join("\n"),
    route: CMO_SEO_ROUTE,
  });
}
