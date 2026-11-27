import type { Prisma } from "@sokosumi/database";

import { getEnv } from "@/config/env";
import { jsonInput } from "@/helpers/prisma-json";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { auditPerformancePage } from "@/lib/seo/audit-performance-pages";
import { IMPACT_FINAL_LAG_DAYS } from "@/lib/seo/impact-window";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import {
  GSC_FINAL_LAG_DAYS,
  GSC_STATS_TOOL,
  gscReportArguments,
  gscReportSchema,
  gscSearchAnalyticsArguments,
  type NativeStatisticsQuery,
  SEO_STATS_MAX_ROWS,
  searchConsoleDay,
  unwrapNativeStatistics,
} from "@/lib/seo/native-statistics";
import { seoPageComparisonKey } from "@/lib/seo/related-page-selection";
import { withDeadline } from "@/lib/with-deadline";
import {
  SEO_IMPACT_INPUT_SCHEMA,
  SEO_IMPACT_MAX_CANDIDATES,
  type SeoImpactDailyRow,
  type SeoImpactInput,
  seoImpactInputSchema,
  seoImpactResultSchema,
} from "@/schemas/seo-impact-worker.schema";
import type { ComposioIntegrationAccount } from "@/services/composio-integration-tools.service";
import { readNativeSeoTool } from "@/services/project-seo-statistics.service";
import { inspectStatisticsPage } from "@/services/project-seo-statistics-inspections";
import {
  projectAccount,
  type SeoImpactTick,
} from "@/services/seo-impact.service";

const DAY_MS = 86_400_000;
/** Changes prepared per tick: each one is at most 3 + 5 Search Console reads. Not calibrated. */
const PREPARES_PER_TICK = 100;
/** Pages read before the change, of which the most seen become the candidates. */
const CANDIDATE_POOL = 100;
/** Kept back from each Google read, so its result is stored before the tick ends. */
const WRITE_RESERVE_MS = 5_000;

export interface SeoImpactPrepareResult {
  skipped: "disabled" | null;
  prepared: number;
  failed: number;
  stopped: boolean;
}

interface FinalRow {
  id: string;
  projectId: string;
  state: string;
  verdict: Prisma.JsonValue;
  pageUrl: string;
  property: string | null;
  changedAt: Date;
  crawledAt: Date | null;
  measuredUrl: string | null;
  suggestion: { status: string; doneAt: Date | null } | null;
}

const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);

/** The URL in the form the worker takes: no fragment, no credentials. */
function workerUrl(url: string) {
  const parsed = URL.parse(url);
  if (!parsed || parsed.username || parsed.password) return null;
  parsed.hash = "";
  return parsed;
}

type Read = (args: Record<string, unknown>) => Promise<unknown>;

async function readRows(read: Read, args: Record<string, unknown>) {
  const body = unwrapNativeStatistics(await read(args), [
    "rows",
    "responseAggregationType",
  ]);
  // Google leaves rows out of an empty report but names its aggregation: a
  // reply with neither is no report, not a day without traffic.
  if (
    !Array.isArray(body.rows) &&
    typeof body.responseAggregationType !== "string"
  )
    throw new Error("Search Console reply has no report");
  return gscReportSchema.parse(body).rows;
}

/** One row per day. CTR is computed here: Google's own is rounded. */
async function readDaily(
  read: Read,
  args: Record<string, unknown>,
): Promise<SeoImpactDailyRow[]> {
  return (await readRows(read, args)).map((row) => ({
    date: row.keys[0] ?? "",
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: row.impressions ? row.clicks / row.impressions : 0,
    position: row.position,
  }));
}

/**
 * The unchanged pages of the page's origin that Google showed most before the
 * change, of the pool Google returns by clicks. Post-change traffic would
 * favour a page the change itself moved.
 */
async function readCandidates(
  read: Read,
  range: Pick<NativeStatisticsQuery, "propertyId" | "from" | "to">,
  page: URL,
  tracked: Set<string>,
) {
  const rows = await readRows(
    read,
    gscReportArguments(range, ["page"], CANDIDATE_POOL),
  );
  const seen = new Set<string>();
  return rows
    .flatMap((row) => {
      const candidate = workerUrl(row.keys[0] ?? "");
      if (!candidate || candidate.origin !== page.origin) return [];
      const key = seoPageComparisonKey(candidate.href);
      if (tracked.has(key) || seen.has(key)) return [];
      seen.add(key);
      return [{ pageUrl: candidate.href, impressions: row.impressions }];
    })
    .sort(
      (a, b) =>
        b.impressions - a.impressions || a.pageUrl.localeCompare(b.pageUrl),
    )
    .slice(0, SEO_IMPACT_MAX_CANDIDATES);
}

/**
 * Only a check of this done change counts: a reopened suggestion that was
 * done and verified again has a later doneAt.
 */
const isVerifiedChange = (row: FinalRow) =>
  row.suggestion?.status === "verified" &&
  row.suggestion.doneAt?.getTime() === row.changedAt.getTime();

/**
 * The URL Google reports the page under. A change crawled before Core kept
 * it asks Google now, so its window stays the one of its first crawl.
 */
async function measuredUrlOf(
  row: FinalRow & { property: string },
  account: ComposioIntegrationAccount,
) {
  if (row.measuredUrl) return row.measuredUrl;
  const page = await inspectStatisticsPage(
    row.property,
    row.pageUrl,
    undefined,
    (args) => readNativeSeoTool(account, GSC_INSPECT_TOOL, args),
  );
  return auditPerformancePage(row.property, row.pageUrl, page).measuredUrl;
}

type PreparedRow = FinalRow & { property: string; crawledAt: Date };

/** The fields of the worker's input that name the change and the read. */
function inputHeader(row: PreparedRow, now: Date) {
  // Google reports the traffic under this URL, and the worker takes candidates
  // of its origin. The change keeps its own URL in the row.
  const page = workerUrl(row.measuredUrl ?? row.pageUrl);
  if (!page) throw new Error("The page URL is no URL the worker takes");
  const header = {
    schema: SEO_IMPACT_INPUT_SCHEMA,
    impactId: row.id,
    pageUrl: page.href,
    property: row.property,
    changedAt: row.changedAt.toISOString(),
    changeSource: "cuso_done" as const,
    changeBounds: null,
    windowCrawl: row.crawledAt.toISOString(),
    pin: null,
    readAt: now.toISOString(),
  };
  return { page, header };
}

/**
 * The input of an unconfirmed change. The worker ends it before it reads a
 * series, so Core asks Google nothing for it.
 */
function unconfirmedInput(row: PreparedRow, now: Date): SeoImpactInput {
  return seoImpactInputSchema.parse({
    ...inputHeader(row, now).header,
    changeCheck: "not_checked",
    pageByDate: [],
    siteByDate: [],
    candidates: [],
  });
}

/**
 * The comparison page of a waiting result, kept for its next read so the
 * retry tests against the same control. None once that page has a tracked
 * change of its own, or is on another origin than the page.
 */
function pinnedPage(row: PreparedRow, page: URL, tracked: Set<string>) {
  if (row.state !== "waiting_retry") return null;
  const saved = seoImpactResultSchema.safeParse(row.verdict);
  const pin = workerUrl(saved.data?.comparison?.pageUrl ?? "");
  if (
    !pin ||
    pin.origin !== page.origin ||
    tracked.has(seoPageComparisonKey(pin.href))
  )
    return null;
  return pin.href;
}

/** The worker's input for one verified change, read now from Search Console. */
async function buildInput(
  row: PreparedRow,
  account: ComposioIntegrationAccount,
  now: Date,
): Promise<SeoImpactInput> {
  const { page, header } = inputHeader(row, now);
  const read: Read = (args) => readNativeSeoTool(account, GSC_STATS_TOOL, args);
  const today = searchConsoleDay(now);
  const to = addDays(today, -GSC_FINAL_LAG_DAYS);
  const range = {
    propertyId: row.property,
    from: addDays(to, -(SEO_STATS_MAX_ROWS - 1)),
    to,
  };
  const pageQuery: NativeStatisticsQuery = {
    provider: "search_console",
    ...range,
    pageUrls: [page.href],
    channel: "organic",
    searchType: "web",
  };
  const beforeChange = addDays(searchConsoleDay(row.changedAt), -1);
  const tracked = await trackedPages(row.projectId);
  const pin = pinnedPage(row, page, tracked);
  const [pageByDate, siteByDate, ranked] = await Promise.all([
    readDaily(
      read,
      gscSearchAnalyticsArguments(
        pageQuery,
        ["date"],
        SEO_STATS_MAX_ROWS,
        "equals",
      ),
    ),
    readDaily(read, gscReportArguments(range, ["date"], SEO_STATS_MAX_ROWS)),
    beforeChange < range.from
      ? []
      : readCandidates(read, { ...range, to: beforeChange }, page, tracked),
  ]);
  // The pin stays a candidate, also where other pages now outrank it.
  const pool = pin
    ? [
        { pageUrl: pin },
        ...ranked.filter(
          (candidate) =>
            seoPageComparisonKey(candidate.pageUrl) !==
            seoPageComparisonKey(pin),
        ),
      ].slice(0, SEO_IMPACT_MAX_CANDIDATES)
    : ranked;
  const candidates = await Promise.all(
    pool.map(async (candidate) => ({
      pageUrl: candidate.pageUrl,
      byDate: await readDaily(
        read,
        gscSearchAnalyticsArguments(
          { ...pageQuery, pageUrls: [candidate.pageUrl] },
          ["date"],
          SEO_STATS_MAX_ROWS,
          "equals",
        ),
      ),
    })),
  );
  return seoImpactInputSchema.parse({
    ...header,
    changeCheck: "verified",
    pageByDate,
    siteByDate,
    candidates,
    pin: pin ? { comparisonPage: pin } : null,
  });
}

/**
 * Every page with a tracked change in the Project, under either host: none
 * of them is unchanged. Google can report a page under its www alias, the
 * only other URL a measured one takes, also where Core could not confirm it.
 */
async function trackedPages(projectId: string) {
  const rows = await prisma.projectSeoImpactVerdict.findMany({
    where: { projectId },
    select: { pageUrl: true },
    distinct: ["pageUrl"],
  });
  return new Set(
    rows.flatMap((row) =>
      URL.canParse(row.pageUrl)
        ? [row.pageUrl, wwwAlias(row.pageUrl)].map(seoPageComparisonKey)
        : [],
    ),
  );
}

/** The same URL with `www.` added to its host, or taken off. */
function wwwAlias(url: string) {
  const alias = new URL(url);
  alias.hostname = alias.hostname.startsWith("www.")
    ? alias.hostname.slice("www.".length)
    : `www.${alias.hostname}`;
  return alias.href;
}

/** Reads a verified change's measured URL and series from Search Console. */
async function readFromGoogle(
  row: PreparedRow,
  account: ReturnType<typeof projectAccount>,
  tick: SeoImpactTick,
  now: Date,
) {
  const connection = await account;
  if (typeof connection === "string")
    throw new Error(`The project's Search Console is ${connection}`);
  // The budget left after the connection lookup: a read started past it
  // would only run on after the timeout.
  const budgetMs = tick.msRemaining() - WRITE_RESERVE_MS;
  if (!(budgetMs > 0)) throw new Error("The Search Console reads timed out");
  return await withDeadline(
    (async () => {
      const measuredUrl = await measuredUrlOf(row, connection);
      const input = await buildInput({ ...row, measuredUrl }, connection, now);
      return { input, measuredUrl };
    })(),
    budgetMs,
    "The Search Console reads timed out",
  );
}

function warnPrepareFailed(projectId: string, error: unknown) {
  recordCoreWarning(
    { operation: "seo_impact_prepare", projectId },
    {
      message:
        "SEO impact tracking could not prepare a change for its verdict.",
      why: "A Search Console read through Cuso's connection failed, or its rows broke the worker's input rules.",
    },
    { failure: messageSafeErrorFields(error) },
  );
}

/**
 * Stores the worker's input for each change whose window Search Console has
 * settled, or whose waiting result named a day that has come, so the SEO
 * worker can claim it. A failed read leaves the change waiting, and a later
 * tick reads it again.
 */
export async function prepareSeoImpactInputs(
  tick: SeoImpactTick,
  now: Date = new Date(),
): Promise<SeoImpactPrepareResult> {
  const result: SeoImpactPrepareResult = {
    skipped: null,
    prepared: 0,
    failed: 0,
    stopped: false,
  };
  const env = getEnv();
  if (!env.SEO_IMPACT_TRACKING_ENABLED || !env.SEO_IMPACT_DISPATCH_ENABLED)
    return { ...result, skipped: "disabled" };
  const lastFinalEnd = addDays(searchConsoleDay(now), -IMPACT_FINAL_LAG_DAYS);
  const rows: FinalRow[] = await prisma.projectSeoImpactVerdict.findMany({
    where: {
      changeSource: "cuso_done",
      OR: [
        {
          state: "waiting_window",
          windowEnd: { lte: new Date(`${lastFinalEnd}T00:00:00Z`) },
        },
        // The worker's retryAfter is a Search Console day: ISO dates sort as text.
        {
          state: "waiting_retry",
          verdict: { path: ["retryAfter"], lte: searchConsoleDay(now) },
        },
      ],
    },
    select: {
      id: true,
      projectId: true,
      state: true,
      verdict: true,
      pageUrl: true,
      property: true,
      changedAt: true,
      crawledAt: true,
      measuredUrl: true,
      suggestion: { select: { status: true, doneAt: true } },
    },
    // A change that keeps failing goes last, so it cannot hold back the others.
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: PREPARES_PER_TICK,
  });
  const accounts = new Map<string, ReturnType<typeof projectAccount>>();
  const accountOf = (projectId: string) => {
    let account = accounts.get(projectId);
    if (!account) {
      account = projectAccount(projectId);
      accounts.set(projectId, account);
    }
    return account;
  };
  for (const row of rows) {
    if (!tick.shouldContinue() || tick.msRemaining() <= WRITE_RESERVE_MS) {
      result.stopped = true;
      return result;
    }
    const { property, crawledAt } = row;
    try {
      if (!property || !crawledAt)
        throw new Error("A waiting window has no property or crawl");
      const prepared = { ...row, property, crawledAt };
      // An unconfirmed change asks Google nothing, so it needs no connection.
      const { input, measuredUrl } = isVerifiedChange(row)
        ? await readFromGoogle(prepared, accountOf(row.projectId), tick, now)
        : {
            input: unconfirmedInput(prepared, now),
            measuredUrl: row.measuredUrl,
          };
      // The suggestion this tick read: one verified or reopened during the
      // Google reads waits for the next tick, which reads it again.
      const { count } = await prisma.projectSeoImpactVerdict.updateMany({
        where: {
          id: row.id,
          state: row.state,
          ...(row.suggestion && {
            suggestion: {
              is: {
                status: row.suggestion.status,
                doneAt: row.suggestion.doneAt,
              },
            },
          }),
        },
        data: {
          state: "ready",
          input: jsonInput(input),
          measuredUrl,
          // A new input: the claims of a waiting one count nothing against it.
          claimId: null,
          claimedUntil: null,
          attempts: 0,
        },
      });
      result.prepared += count;
    } catch (error) {
      result.failed += 1;
      warnPrepareFailed(row.projectId, error);
      // Moves the change behind the others for the next tick.
      await prisma.projectSeoImpactVerdict.updateMany({
        where: { id: row.id, state: row.state },
        data: { updatedAt: now },
      });
    }
  }
  return result;
}
