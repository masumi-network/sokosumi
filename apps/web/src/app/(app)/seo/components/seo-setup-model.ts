import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoFullAuditAutoPages } from "@sokosumi/utils";
import {
  defaultFullAuditSeconds,
  type SeoAnalysisKind,
} from "./seo-form-model";

/**
 * done: finished. next: the one step that carries the primary button.
 * running: a check is in flight. waiting: needs the step before it.
 */
export type SeoSetupState = "done" | "next" | "running" | "waiting";

export function seoSetupPages(workspace: ProjectSeoWorkspace) {
  const byId = new Map(workspace.pages.map((page) => [page.id, page]));
  return workspace.scope.pageIds
    .map((id) => byId.get(id))
    .filter((page) => page !== undefined);
}

type SeoAnalysis = ProjectSeoWorkspace["analyses"][number];
/** Core does not promise an order: the newest by date decides. */
const newestAnalysis = (analyses: SeoAnalysis[]) =>
  analyses.reduce<SeoAnalysis | null>(
    (latest, analysis) =>
      !latest || new Date(analysis.createdAt) > new Date(latest.createdAt)
        ? analysis
        : latest,
    null,
  );

/**
 * A check older than this is no check in flight. Core has no end for a check whose Task ended without a result:
 * the page stops saying that it runs, and the reader can start the next. The longest check, a full audit, has a
 * time limit of 90 minutes.
 */
export const SEO_CHECK_STALE_MS = 3 * 60 * 60_000;

/** The newest check that Core accepted and has not finished, if it started less than three hours ago. */
export function seoRunningCheck(
  workspace: ProjectSeoWorkspace,
  now = new Date(),
) {
  const check = newestAnalysis(
    workspace.analyses.filter(
      (analysis) =>
        analysis.status === "requested" || analysis.status === "running",
    ),
  );
  return check &&
    now.getTime() - new Date(check.createdAt).getTime() < SEO_CHECK_STALE_MS
    ? check
    : null;
}

/** A check in flight that a new one must wait for. */
export function seoCheckBlocking(workspace: ProjectSeoWorkspace, now: Date) {
  return seoRunningCheck(workspace, now) !== null;
}

/**
 * The time a full audit needs after its last page: the steps for the whole site, then the report files. Measured
 * on the first audit that added pages (2026-11-22, 5 pages): the last page ended after 28 minutes, the Task after 48.
 */
const SEO_AFTER_PAGES_SECONDS = 1200;
/** The bar never shows a full share: only the result says that the check is done. */
const SEO_RUN_SHARE_MAX = 0.95;
const MINUTE_MS = 60_000;

/**
 * How far the check in flight is, as an estimate. Core reports no progress and no end time, so the usual time
 * is the middle time of the earlier runs of the same kind. A full audit takes at least the time of its pages: the
 * selected pages and the pages it adds. An earlier full audit can be shorter, because it added no page. A first
 * check of another kind has no usual time: no share and no time left.
 * A check whose Task has not started yet is queued: it has no estimate, because the time until the start is unknown.
 */
export function seoRunProgress(workspace: ProjectSeoWorkspace, now: Date) {
  const check = seoRunningCheck(workspace, now);
  if (!check) return null;
  if (check.status === "requested")
    return { queued: true, share: null, minutesLeft: null, late: false };
  const earlier = (workspace.runs ?? [])
    .flatMap((run) =>
      run.kind === check.kind && run.seconds ? [run.seconds] : [],
    )
    .sort((a, b) => a - b);
  const middle = earlier.length
    ? earlier[Math.floor((earlier.length - 1) / 2)]
    : 0;
  const selected = check.pageIds.length;
  const pagesSeconds =
    check.kind === "audit_full"
      ? defaultFullAuditSeconds(selected + seoFullAuditAutoPages(selected)) +
        SEO_AFTER_PAGES_SECONDS
      : 0;
  const usualSeconds = Math.max(middle, pagesSeconds);
  if (!usualSeconds)
    return { queued: false, share: null, minutesLeft: null, late: false };
  const usual = usualSeconds * 1000;
  // A clock that runs behind Core's gives a time before the start.
  const elapsed = Math.max(
    0,
    now.getTime() - new Date(check.createdAt).getTime(),
  );
  const late = elapsed >= usual;
  return {
    queued: false,
    share: Math.min(SEO_RUN_SHARE_MAX, elapsed / usual),
    // To the nearest minute, like the start time beside it, and never "0 minutes".
    minutesLeft: late
      ? null
      : Math.max(1, Math.round((usual - elapsed) / MINUTE_MS)),
    late,
  };
}

/** A check that Core accepted and has not finished. */
export function seoCheckRunning(workspace: ProjectSeoWorkspace) {
  return seoRunningCheck(workspace) !== null;
}

/** A check can start now: the workspace allows one and none runs. */
function seoRunReady(workspace: ProjectSeoWorkspace) {
  return (
    workspace.availableActions.canRequestAnalysis && !seoCheckRunning(workspace)
  );
}

/**
 * The run of the checks card: the widest check this workspace can run on its pages.
 * A full audit needs paid search data and pages on one host. After a failed free first check, the free page check once again.
 * Null where the reader can run no check at all.
 */
export function seoRunAction(workspace: ProjectSeoWorkspace) {
  const { canEdit, canUsePaidSearchData, canRequestAnalysis } =
    workspace.availableActions;
  const check = seoRunningCheck(workspace);
  const running = check !== null;
  // Accepted, and its Task has not started.
  const queued = check?.status === "requested";
  const pageIds = new Set(workspace.scope.pageIds);
  if (!canEdit || !pageIds.size || (!canRequestAnalysis && !running))
    return null;
  const hosts = new Set(
    workspace.pages
      .filter((page) => pageIds.has(page.id))
      .map((page) => new URL(page.url).host),
  );
  // The first check is free: after it failed, the reader gets it once again, not the paid check. The card has one
  // run button, so after a second failed page check it offers the full audit again: a site that blocks the page
  // fetcher can still get results from paid search data.
  const newest = newestAnalysis(workspace.analyses);
  const retriesFreeFirstCheck =
    !workspace.observations.length &&
    !workspace.runs?.length &&
    newest?.status === "failed" &&
    newest.kind === "page_check" &&
    workspace.analyses.filter((analysis) => analysis.kind === "page_check")
      .length === 1;
  const full =
    canUsePaidSearchData === true && hosts.size === 1 && !retriesFreeFirstCheck;
  return {
    kind: full ? "audit_full" : "page_check",
    label: queued
      ? "runs.queued"
      : running
        ? "setup.checkRunningBadge"
        : full
          ? "runFullAudit"
          : "runPageCheck",
    running,
    queued,
    ready: seoRunReady(workspace),
  } as const satisfies { kind: SeoAnalysisKind; [key: string]: unknown };
}

/** The filters that narrow the page or the period. Setup speaks for the whole Audit. */
export type SeoSetupFilters = {
  from: string | null;
  to: string | null;
  pageId: string | null;
  scopeId: string | null;
  channel: string | null;
};

/**
 * The first-run steps of an Audit: add a page, then run the first check.
 * Search statistics are no step here: a banner offers them, so the first
 * result does not wait for a Google account.
 * Correction: setup now offers Google between the page and the check. An explicit skip keeps public-page checks available.
 * Null once a check has saved a result, when the reader cannot edit, when a
 * filter narrows the view, and when the reader can run no check on the pages.
 * Correction: unavailable dispatch keeps the Google choice and a final explanation in setup.
 */
export function seoSetup(
  workspace: ProjectSeoWorkspace,
  filters?: SeoSetupFilters,
  googleReady = false,
) {
  const { canEdit } = workspace.availableActions;
  if (workspace.observations.length || workspace.runs?.length || !canEdit)
    return null;
  // A narrowed read can leave out pages and checks.
  if (
    filters?.from ||
    filters?.to ||
    filters?.pageId ||
    filters?.scopeId ||
    filters?.channel
  )
    return null;
  const hasPages = workspace.scope.pageIds.length > 0;
  const running = seoCheckRunning(workspace);
  // Google connection and an explicit skip remain available even while the check service is off, and while the
  // free check that starts with a new audit runs: that check is no Google choice.
  const connection: SeoSetupState = googleReady
    ? "done"
    : hasPages
      ? "next"
      : "waiting";
  const check: SeoSetupState = running
    ? "running"
    : hasPages && connection === "done"
      ? "next"
      : "waiting";
  return {
    page: hasPages ? "done" : "next",
    connection,
    check,
    next: !hasPages
      ? "page"
      : running
        ? null
        : connection === "next"
          ? "connection"
          : "check",
    // A failed check asks for a new run; while another check runs it is no news.
    failed:
      check === "next" &&
      newestAnalysis(workspace.analyses)?.status === "failed",
  } as const;
}

export type SeoSetup = NonNullable<ReturnType<typeof seoSetup>>;
