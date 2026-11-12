import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  defaultFullAuditSeconds,
  type SeoAnalysisKind,
} from "./seo-form-model";
import { seoOverviewModel } from "./seo-overview-model";

/**
 * done: finished. next: the one step that carries the primary button.
 * running: a check is in flight. waiting: needs the step before it.
 */
export type SeoSetupState = "done" | "next" | "running" | "waiting";

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

/** The newest check that Core accepted and has not finished. */
export function seoRunningCheck(workspace: ProjectSeoWorkspace) {
  return newestAnalysis(
    workspace.analyses.filter(
      (analysis) =>
        analysis.status === "requested" || analysis.status === "running",
    ),
  );
}

/**
 * A check older than this blocks no new one. Core has no end for a check whose Task ended without a result: the
 * reader needs a way to start the next. The longest check, a full audit, has a time limit of one hour.
 */
const SEO_CHECK_STALE_MS = 3 * 60 * 60_000;

/** A check in flight that a new one must wait for: it started less than three hours ago. */
export function seoCheckBlocking(workspace: ProjectSeoWorkspace, now: Date) {
  const check = seoRunningCheck(workspace);
  return Boolean(
    check &&
      now.getTime() - new Date(check.createdAt).getTime() < SEO_CHECK_STALE_MS,
  );
}

/** A full audit ends some minutes after its time limit: the last steps run after it. */
const SEO_AFTER_LIMIT_SECONDS = 300;
/** The bar never shows a full share: only the result says that the check is done. */
const SEO_RUN_SHARE_MAX = 0.95;
const MINUTE_MS = 60_000;

/**
 * How far the check in flight is, as an estimate. Core reports no progress and no end time, so the usual time
 * is the middle time of the earlier runs of the same kind. A first full audit has none: its usual time is the
 * default time limit of its pages. Another first check has no usual time: no share and no time left.
 */
export function seoRunProgress(workspace: ProjectSeoWorkspace, now: Date) {
  const check = seoRunningCheck(workspace);
  if (!check) return null;
  const earlier = (workspace.runs ?? [])
    .flatMap((run) =>
      run.kind === check.kind && run.seconds ? [run.seconds] : [],
    )
    .sort((a, b) => a - b);
  const usualSeconds = earlier.length
    ? earlier[Math.floor((earlier.length - 1) / 2)]
    : check.kind === "audit_full"
      ? defaultFullAuditSeconds(check.pageIds.length) + SEO_AFTER_LIMIT_SECONDS
      : null;
  if (!usualSeconds) return { share: null, minutesLeft: null, late: false };
  const usual = usualSeconds * 1000;
  // A clock that runs behind Core's gives a time before the start.
  const elapsed = Math.max(
    0,
    now.getTime() - new Date(check.createdAt).getTime(),
  );
  const late = elapsed >= usual;
  return {
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
 * The header's run button is filled: a check can start and no result waits for the reader.
 * A recommended action from the last check comes first. On the Agent and Actions tabs its own
 * button is the filled one; on the other tabs the header stays the same, so no button is filled there.
 */
export function seoRunLeads(workspace: ProjectSeoWorkspace) {
  return (
    seoRunReady(workspace) &&
    !seoOverviewModel(workspace).recommendedActions.length
  );
}

/**
 * The header's run button: the widest check this workspace can run on its pages.
 * A full audit needs paid search data and pages on one host. Null where the reader can run no check at all.
 */
export function seoRunAction(workspace: ProjectSeoWorkspace) {
  const { canEdit, canUsePaidSearchData } = workspace.availableActions;
  const pageIds = new Set(workspace.scope.pageIds);
  if (!canEdit || !pageIds.size) return null;
  const hosts = new Set(
    workspace.pages
      .filter((page) => pageIds.has(page.id))
      .map((page) => new URL(page.url).host),
  );
  const full = canUsePaidSearchData === true && hosts.size === 1;
  const running = seoCheckRunning(workspace);
  return {
    kind: full ? "audit_full" : "page_check",
    label: running
      ? "setup.checkRunningBadge"
      : full
        ? "runFullAudit"
        : "runPageCheck",
    running,
    ready: seoRunReady(workspace),
    leads: seoRunLeads(workspace),
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
 * Null once a check has saved a result, when the reader cannot edit, when a
 * filter narrows the view, and when the reader can run no check on the pages.
 */
export function seoSetup(
  workspace: ProjectSeoWorkspace,
  filters?: SeoSetupFilters,
) {
  const { canEdit, canRequestAnalysis } = workspace.availableActions;
  if (workspace.observations.length || !canEdit) return null;
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
  // With a page and no right to run a check, no step is left for the reader.
  if (hasPages && !running && !canRequestAnalysis) return null;
  const check: SeoSetupState = running
    ? "running"
    : hasPages
      ? "next"
      : "waiting";
  return {
    page: hasPages ? "done" : "next",
    check,
    next: hasPages ? (running ? null : "check") : "page",
    // A failed check asks for a new run; while another check runs it is no news.
    failed:
      check === "next" &&
      newestAnalysis(workspace.analyses)?.status === "failed",
  } as const;
}

export type SeoSetup = NonNullable<ReturnType<typeof seoSetup>>;
