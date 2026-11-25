import { getEnv } from "@/config/env";
import prisma from "@/lib/db/prisma";
import { isEvalCusoProject, isEvalWorkspace } from "@/lib/evals/eval-guard";
import { recordCoreWarning } from "@/lib/evlog";
import { messageSafeErrorFields } from "@/lib/safe-error-fields";
import { impactWindow } from "@/lib/seo/impact-window";
import { GSC_INSPECT_TOOL } from "@/lib/seo/native-gsc-inspection";
import { gscPropertyCovers } from "@/lib/seo/native-gsc-property";
import type { SeoImpactReason } from "@/schemas/seo-impact.schema";
import { LIVE_CUSO_WHERE } from "@/services/cmo-cuso.service";
import {
  pickProperty,
  searchConsoleAccount,
} from "@/services/cmo-seo-research.service";
import {
  propertyChoices,
  readNativeSeoTool,
} from "@/services/project-seo-statistics.service";
import { inspectStatisticsPage } from "@/services/project-seo-statistics-inspections";
import { normalizeSeoUrl } from "@/services/project-seo-store";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** A row that sees no crawl after the change for this many days cannot be measured. Not calibrated. */
export const IMPACT_CRAWL_WAIT_DAYS = 28;
/** Under a day, so the daily cron's start time drift never skips a day of URL Inspection. */
const INSPECT_INTERVAL_MS = 20 * HOUR_MS;

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
  | { reason: SeoImpactReason; property: string | null };

/**
 * One row per done page change: a suggestion marked done again after a reopen
 * gets a new row, and its earlier rows stay. Test copies and eval projects
 * are no customers, so they get none.
 */
async function recordDoneChanges(): Promise<number> {
  const suggestions = await prisma.projectSeoSuggestion.findMany({
    where: {
      kind: "page_change",
      status: { in: ["done", "verified"] },
      pageUrl: { not: null },
      doneAt: { not: null },
      project: { testCopyOfProjectId: null },
    },
    select: {
      id: true,
      projectId: true,
      pageUrl: true,
      doneAt: true,
      project: { select: { workspaceId: true } },
      impactVerdicts: {
        orderBy: { changedAt: "desc" },
        take: 1,
        select: { changedAt: true },
      },
    },
  });
  const rows = [];
  for (const suggestion of suggestions) {
    const { doneAt, pageUrl } = suggestion;
    if (!doneAt || !pageUrl) continue;
    if (suggestion.impactVerdicts[0]?.changedAt.getTime() === doneAt.getTime())
      continue;
    if (
      (await isEvalWorkspace(suggestion.project.workspaceId)) ||
      (await isEvalCusoProject(suggestion.projectId))
    )
      continue;
    rows.push({
      projectId: suggestion.projectId,
      changeSource: "cuso_done",
      suggestionId: suggestion.id,
      changedAt: doneAt,
      pageUrl,
    });
  }
  if (rows.length === 0) return 0;
  // A concurrent tick inserts the same rows: the unique key keeps one.
  const { count } = await prisma.projectSeoImpactVerdict.createMany({
    data: rows,
    skipDuplicates: true,
  });
  return count;
}

/** URL Inspection of each waiting page, through the Project's Cuso connection. */
async function inspectProject(
  projectId: string,
  rows: WaitingRow[],
  shouldContinue: () => boolean,
): Promise<Map<string, Inspection>> {
  const all = (reason: SeoImpactReason, property: string | null = null) =>
    new Map(rows.map((row) => [row.id, { reason, property }]));
  const cuso = await prisma.sokoBot.findFirst({
    where: { ...LIVE_CUSO_WHERE, projectId },
    select: { id: true, project: { select: { websiteUrl: true } } },
  });
  if (!cuso) return all("no_cuso");
  const account = await searchConsoleAccount(cuso.id);
  if (!account) return all("not_connected");
  let property: string | null;
  try {
    const choices = await propertyChoices(account, "search_console");
    property = pickProperty(
      choices.properties.map((choice) => choice.id),
      normalizeSeoUrl(cuso.project?.websiteUrl ?? ""),
    );
  } catch (error) {
    warnInspectionFailed(projectId, "property_list", error);
    return all("inspection_failed");
  }
  if (!property) return all("no_property");

  const read = (args: Record<string, unknown>) =>
    readNativeSeoTool(account, GSC_INSPECT_TOOL, args);
  const outcomes = new Map<string, Inspection>();
  for (const row of rows) {
    if (!shouldContinue()) break;
    if (!gscPropertyCovers(property, [row.pageUrl])) {
      outcomes.set(row.id, { reason: "page_outside_property", property });
      continue;
    }
    try {
      const page = await inspectStatisticsPage(
        property,
        row.pageUrl,
        undefined,
        read,
      );
      const crawledAt = page.lastCrawlTime
        ? new Date(page.lastCrawlTime)
        : null;
      // Google reports only its last crawl: one before the change says nothing about it.
      outcomes.set(
        row.id,
        crawledAt && crawledAt > row.changedAt
          ? { crawledAt, property }
          : { reason: "not_crawled_yet", property },
      );
    } catch (error) {
      warnInspectionFailed(projectId, "url_inspection", error);
      outcomes.set(row.id, { reason: "inspection_failed", property });
    }
  }
  return outcomes;
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
    await prisma.projectSeoImpactVerdict.updateMany({
      where: { id: row.id, state: "waiting_crawl", crawledAt: null },
      data: {
        state: "waiting_window",
        reason: null,
        property: inspection.property,
        inspectedAt: now,
        crawledAt: inspection.crawledAt,
        windowStart: new Date(`${window.windowStart}T00:00:00Z`),
        windowEnd: new Date(`${window.windowEnd}T00:00:00Z`),
      },
    });
    return "crawled";
  }
  const expired =
    now.getTime() - row.createdAt.getTime() >= IMPACT_CRAWL_WAIT_DAYS * DAY_MS;
  await prisma.projectSeoImpactVerdict.updateMany({
    where: { id: row.id, state: "waiting_crawl" },
    data: {
      state: expired ? "not_measurable" : "waiting_crawl",
      reason: inspection.reason,
      property: inspection.property,
      inspectedAt: now,
    },
  });
  return expired ? "not_measurable" : "waiting";
}

/**
 * The daily impact tracking run: records done page changes, then inspects
 * each page still waiting for Google's crawl, at most once a day.
 */
export async function syncSeoImpact(
  shouldContinue: () => boolean = () => true,
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

  result.recorded = await recordDoneChanges();
  const waiting = await prisma.projectSeoImpactVerdict.findMany({
    where: {
      state: "waiting_crawl",
      OR: [
        { inspectedAt: null },
        { inspectedAt: { lt: new Date(now.getTime() - INSPECT_INTERVAL_MS) } },
      ],
    },
    select: {
      id: true,
      projectId: true,
      pageUrl: true,
      changedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  const byProject = Map.groupBy(waiting, (row) => row.projectId);
  for (const [projectId, rows] of byProject) {
    if (!shouldContinue()) {
      result.stopped = true;
      break;
    }
    const outcomes = await inspectProject(projectId, rows, shouldContinue);
    if (outcomes.size < rows.length) result.stopped = true;
    for (const row of rows) {
      const inspection = outcomes.get(row.id);
      if (!inspection) continue;
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
