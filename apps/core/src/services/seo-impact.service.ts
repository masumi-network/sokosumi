import { sharedTable } from "@sokosumi/database/sql-tables";

import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { impactWindow } from "@/lib/seo/impact-window";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { withDeadline } from "@/lib/with-deadline";
import type { SeoImpactReason } from "@/schemas/seo-impact.schema";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";
import {
  pickProperty,
  searchConsoleAccount,
} from "@/services/cmo-seo-research.service";
import type { ComposioIntegrationAccount } from "@/services/composio-integration-tools.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "@/services/project-seo-statistics.service";
import { inspectStatisticsPage } from "@/services/project-seo-statistics-inspections";
import { trackedSeoChange } from "@/services/seo-impact-record";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A row that sees no crawl after the change for this many days cannot be measured. Not calibrated. */
export const IMPACT_CRAWL_WAIT_DAYS = 28;
/** Under a day, so the daily cron's start time drift never skips a day of URL Inspection. */
const INSPECT_INTERVAL_MS = 20 * HOUR_MS;
/** Done suggestions read per query while recording changes the status writes missed. */
const RECORD_BATCH_SIZE = 200;
/** Waiting pages inspected per tick, well under Google's daily URL Inspection quota. Not calibrated. */
const INSPECTIONS_PER_TICK = 500;
/** Kept back from each Google read, so its result is stored before the tick ends. */
const WRITE_RESERVE_MS = 5_000;
/** Below every UUID: the first batch of the backfill starts after it. */
const FIRST_ID = "00000000-0000-0000-0000-000000000000";

/** The tick's time budget: a cron route passes its run context. */
export interface SeoImpactTick {
  shouldContinue: () => boolean;
  msRemaining: () => number;
}

const UNBOUNDED_TICK: SeoImpactTick = {
  shouldContinue: () => true,
  msRemaining: () => Number.POSITIVE_INFINITY,
};

export interface SeoImpactSyncResult {
  skipped: "disabled" | null;
  recorded: number;
  inspected: number;
  crawled: number;
  notMeasurable: number;
  failed: number;
  stopped: boolean;
}

interface WaitingRow {
  id: string;
  projectId: string;
  pageUrl: string;
  changedAt: Date;
  createdAt: Date;
}

type Inspection =
  | { crawledAt: Date; property: string }
  | {
      reason: SeoImpactReason;
      property: string | null;
      /** No later tick can answer otherwise: the row ends now. */
      final?: true;
    };

/** Not inspected this tick: the row keeps its state, and a later tick asks again. */
const DEFERRED = "deferred";

interface DoneSuggestionRow {
  id: string;
  projectId: string;
  kind: string;
  title: string;
  status: string;
  pageUrl: string;
  doneAt: Date;
  workspaceId: string;
  testCopyOfProjectId: string | null;
}

/**
 * The backfill: records done page changes no status write recorded, such as
 * those done before tracking was on. Only changes without a row are read.
 */
async function recordDoneChanges(
  tick: SeoImpactTick,
): Promise<{ recorded: number; stopped: boolean }> {
  let recorded = 0;
  let after = FIRST_ID;
  for (;;) {
    if (!tick.shouldContinue()) return { recorded, stopped: true };
    const batch = await prisma.$queryRaw<DoneSuggestionRow[]>`
      SELECT s.id, s."projectId", s.kind, s.title, s.status, s."pageUrl",
        s."doneAt", p."workspaceId", p."testCopyOfProjectId"
      FROM ${sharedTable("project_seo_suggestion")} s
      JOIN ${sharedTable("project")} p ON p.id = s."projectId"
      WHERE s.kind = 'page_change'
        AND s.status IN ('done', 'verified')
        AND s."pageUrl" IS NOT NULL
        AND s."pageUrl" <> ''
        AND s."doneAt" IS NOT NULL
        AND p."testCopyOfProjectId" IS NULL
        -- Eval projects are no customers. Skipped here, before LIMIT, so a
        -- batch of them never holds back a customer's change.
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("eval_lane")} e
          WHERE e."workspaceId" = p."workspaceId" OR e."cusoProjectId" = s."projectId"
        )
        AND s.id > ${after}::uuid
        AND NOT EXISTS (
          SELECT 1 FROM ${sharedTable("project_seo_impact_verdict")} v
          WHERE v."suggestionId" = s.id AND v."changedAt" = s."doneAt"
        )
      ORDER BY s.id
      LIMIT ${RECORD_BATCH_SIZE}`;
    const rows = batch.flatMap(
      (suggestion) => trackedSeoChange(suggestion, suggestion) ?? [],
    );
    if (rows.length > 0) {
      // A concurrent tick or status write inserts the same rows: the unique key keeps one.
      const { count } = await prisma.projectSeoImpactVerdict.createMany({
        data: rows,
        skipDuplicates: true,
      });
      recorded += count;
    }
    const last = batch.at(-1);
    if (!last || batch.length < RECORD_BATCH_SIZE)
      return { recorded, stopped: false };
    after = last.id;
  }
}

/** The tick's lookups: each Project's connection and each account's properties, read once. */
interface TickLookups {
  accounts: Map<string, Promise<ComposioIntegrationAccount | SeoImpactReason>>;
  properties: Map<string, Promise<string[] | null>>;
}

function once<T>(
  cache: Map<string, Promise<T>>,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let value = cache.get(key);
  if (!value) {
    value = load();
    cache.set(key, value);
  }
  return value;
}

/** The Search Console connection of the Project's Cuso. */
async function projectAccount(
  projectId: string,
): Promise<ComposioIntegrationAccount | SeoImpactReason> {
  const cuso = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true },
  });
  if (!cuso) return "no_cuso";
  return (await searchConsoleAccount(cuso.id)) ?? "not_connected";
}

async function accountProperties(
  account: ComposioIntegrationAccount,
  projectId: string,
  budgetMs: number,
): Promise<string[] | null> {
  try {
    const choices = await withDeadline(
      propertyChoices(account, "search_console"),
      budgetMs,
      "The Search Console property list timed out",
    );
    return choices.properties.map((choice) => choice.id);
  } catch (error) {
    warnInspectionFailed(projectId, "property_list", error);
    return null;
  }
}

/** URL Inspection of one waiting page, in the property that covers it. */
async function inspectRow(
  row: WaitingRow,
  lookups: TickLookups,
  budgetMs: () => number,
): Promise<Inspection | typeof DEFERRED> {
  // Only a web page has a Search Console property: ask Google nothing for
  // another URL or a text that is no URL, and never again.
  const protocol = URL.parse(row.pageUrl)?.protocol;
  if (protocol !== "http:" && protocol !== "https:")
    return { reason: "no_property", property: null, final: true };
  const account = await once(lookups.accounts, row.projectId, () =>
    projectAccount(row.projectId),
  );
  if (typeof account === "string") return { reason: account, property: null };
  const asksGoogle = !lookups.properties.has(account.composioAccountId);
  // The connection lookup can have spent the tick: start no read it cannot finish.
  const lookupMs = budgetMs();
  if (asksGoogle && lookupMs <= 0) return DEFERRED;
  const ids = await once(lookups.properties, account.composioAccountId, () =>
    accountProperties(account, row.projectId, lookupMs),
  );
  // Only the page whose lookup failed counts the failure: the account's other
  // pages were not asked, so they wait for a later tick.
  if (!ids)
    return asksGoogle
      ? { reason: "inspection_failed", property: null }
      : DEFERRED;
  const property = pickProperty(ids, row.pageUrl);
  if (!property) return { reason: "no_property", property: null };
  // The property lookup can have spent the tick: start no read it cannot finish.
  const inspectMs = budgetMs();
  if (inspectMs <= 0) return DEFERRED;
  try {
    const page = await withDeadline(
      inspectStatisticsPage(property, row.pageUrl, undefined, (args) =>
        readNativeSeoTool(account, GSC_INSPECT_TOOL, args),
      ),
      inspectMs,
      "URL Inspection timed out",
    );
    const crawledAt = page.lastCrawlTime ? new Date(page.lastCrawlTime) : null;
    // Google reports only its last crawl: one before the change says nothing about it.
    return crawledAt && crawledAt > row.changedAt
      ? { crawledAt, property }
      : { reason: "not_crawled_yet", property };
  } catch (error) {
    warnInspectionFailed(row.projectId, "url_inspection", error);
    return { reason: "inspection_failed", property };
  }
}

function warnInspectionFailed(
  projectId: string,
  stage: string,
  error: unknown,
) {
  recordCoreWarning(
    { operation: "seo_impact_sync", projectId },
    {
      message: "SEO impact tracking could not read Search Console.",
      why: "The Google read through Cuso's connection failed or was refused.",
    },
    { stage, failure: messageSafeErrorFields(error) },
  );
}

/**
 * Writes one inspection. The first crawl after the change fixes the window;
 * the row then leaves waiting_crawl, so a later crawl never moves it.
 */
async function applyInspection(
  row: WaitingRow,
  inspection: Inspection,
  now: Date,
): Promise<"crawled" | "not_measurable" | "waiting"> {
  if ("crawledAt" in inspection) {
    const window = impactWindow(row.changedAt, inspection.crawledAt);
    // Of two ticks at once, only the one that moved the row counts it. A
    // crawl also stands over a tick that gave the page up meanwhile.
    const { count } = await prisma.projectSeoImpactVerdict.updateMany({
      where: {
        id: row.id,
        state: { in: ["waiting_crawl", "not_measurable"] },
        crawledAt: null,
      },
      data: {
        state: "waiting_window",
        reason: null,
        property: inspection.property,
        lastInspectedAt: now,
        crawledAt: inspection.crawledAt,
        windowStart: new Date(`${window.windowStart}T00:00:00Z`),
        windowEnd: new Date(`${window.windowEnd}T00:00:00Z`),
      },
    });
    return count ? "crawled" : "waiting";
  }
  const expired =
    inspection.final ||
    now.getTime() - row.createdAt.getTime() >= IMPACT_CRAWL_WAIT_DAYS * DAY_MS;
  const { count } = await prisma.projectSeoImpactVerdict.updateMany({
    // A newer tick's answer stands over this one that writes later.
    where: {
      id: row.id,
      state: "waiting_crawl",
      OR: [{ lastInspectedAt: null }, { lastInspectedAt: { lt: now } }],
    },
    data: {
      state: expired ? "not_measurable" : "waiting_crawl",
      reason: inspection.reason,
      property: inspection.property,
      lastInspectedAt: now,
    },
  });
  return expired && count ? "not_measurable" : "waiting";
}

/**
 * The daily impact tracking run: records done page changes the status writes
 * missed, then inspects each page still waiting for Google's crawl, at most
 * once a day. Pages never inspected go first, then the longest unseen, so a
 * page that stays uncrawled cannot hold back the others. Each result is
 * stored before the next read starts.
 */
export async function syncSeoImpact(
  tick: SeoImpactTick = UNBOUNDED_TICK,
  now: Date = new Date(),
): Promise<SeoImpactSyncResult> {
  const result: SeoImpactSyncResult = {
    skipped: null,
    recorded: 0,
    inspected: 0,
    crawled: 0,
    notMeasurable: 0,
    failed: 0,
    stopped: false,
  };
  if (!getEnv().SEO_IMPACT_TRACKING_ENABLED)
    return { ...result, skipped: "disabled" };

  const recording = await recordDoneChanges(tick);
  result.recorded = recording.recorded;
  if (recording.stopped) return { ...result, stopped: true };
  const lookups: TickLookups = { accounts: new Map(), properties: new Map() };
  const budgetMs = () => tick.msRemaining() - WRITE_RESERVE_MS;
  // A project whose Search Console read failed waits for the next tick. Its
  // pages leave the query, so they cannot fill a page and starve the others.
  const deferredProjects = new Set<string>();
  while (result.inspected < INSPECTIONS_PER_TICK) {
    // PR 1b's audit rechecks wait by their own rule.
    const waiting = await prisma.projectSeoImpactVerdict.findMany({
      where: {
        state: "waiting_crawl",
        changeSource: "cuso_done",
        projectId: { notIn: [...deferredProjects] },
        OR: [
          { lastInspectedAt: null },
          {
            lastInspectedAt: {
              lt: new Date(now.getTime() - INSPECT_INTERVAL_MS),
            },
          },
        ],
      },
      select: {
        id: true,
        projectId: true,
        pageUrl: true,
        changedAt: true,
        createdAt: true,
      },
      orderBy: [
        { lastInspectedAt: { sort: "asc", nulls: "first" } },
        { id: "asc" },
      ],
      take: INSPECTIONS_PER_TICK - result.inspected,
    });
    if (waiting.length === 0) break;
    // Each page leaves the query: an inspected row by its new inspection
    // time or state, a deferred row with its project.
    for (const row of waiting) {
      if (deferredProjects.has(row.projectId)) continue;
      if (!tick.shouldContinue() || budgetMs() <= 0) {
        result.stopped = true;
        return result;
      }
      const inspection = await inspectRow(row, lookups, budgetMs);
      if (inspection === DEFERRED) {
        if (budgetMs() <= 0) {
          result.stopped = true;
          return result;
        }
        deferredProjects.add(row.projectId);
        continue;
      }
      result.inspected += 1;
      if ("reason" in inspection && inspection.reason === "inspection_failed")
        result.failed += 1;
      const outcome = await applyInspection(row, inspection, now);
      if (outcome === "crawled") result.crawled += 1;
      if (outcome === "not_measurable") result.notMeasurable += 1;
    }
  }
  return result;
}
