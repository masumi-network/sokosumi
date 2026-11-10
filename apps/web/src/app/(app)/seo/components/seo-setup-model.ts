import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { latestSeoMeasurements } from "./seo-statistics-model";

export type SeoSetupStepKind = "page" | "connect" | "sync" | "check";
/**
 * What is known of the reader's Search Console account. checking: the read
 * has no answer yet. unavailable: this workspace cannot connect Google.
 */
export type SeoSetupGoogle =
  | "connected"
  | "not_connected"
  | "unavailable"
  | "checking";
/**
 * done: finished. next: the one step that carries the primary button.
 * open: can be done now, but an earlier step comes first. running: a check is in flight.
 * waiting: needs an earlier step. unavailable: this workspace cannot do it.
 */
export type SeoSetupState =
  | "done"
  | "next"
  | "open"
  | "running"
  | "waiting"
  | "unavailable";
export type SeoSetupStep = { kind: SeoSetupStepKind; state: SeoSetupState };

/** A check that Core accepted and has not finished. */
export function seoCheckRunning(workspace: ProjectSeoWorkspace) {
  return workspace.analyses.some(
    (analysis) =>
      analysis.status === "requested" || analysis.status === "running",
  );
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
 * The first-run steps of an Audit: add a page, connect Google, sync the
 * search statistics, run the first check. The account and its sync are two
 * steps: a connected account has saved nothing yet.
 * Null once a check has saved a result, when the reader cannot edit, when a
 * filter narrows the view, and when no step is left that the reader can do.
 */
export function seoSetup(
  workspace: ProjectSeoWorkspace,
  filters?: SeoSetupFilters,
  google: SeoSetupGoogle = "not_connected",
) {
  const { canEdit, canSyncMetrics, canRequestAnalysis } =
    workspace.availableActions;
  if (workspace.observations.length || !canEdit) return null;
  // A narrowed read can leave out pages, checks and saved statistics.
  if (
    filters?.from ||
    filters?.to ||
    filters?.pageId ||
    filters?.scopeId ||
    filters?.channel
  )
    return null;
  const hasPages = workspace.scope.pageIds.length > 0;
  const searchSaved = latestSeoMeasurements(workspace.metrics).some(
    (metric) => metric.source === "search_console",
  );
  const running = seoCheckRunning(workspace);
  // Core does not promise an order: the newest check by date decides.
  const newest = workspace.analyses.reduce<
    ProjectSeoWorkspace["analyses"][number] | null
  >(
    (latest, analysis) =>
      !latest || new Date(analysis.createdAt) > new Date(latest.createdAt)
        ? analysis
        : latest,
    null,
  );
  // With no page Core reports no sync and no check right, so the later steps wait.
  const blocked = (allowed: boolean) =>
    !hasPages ? "waiting" : allowed ? "todo" : "unavailable";
  const syncable = canSyncMetrics && google !== "unavailable";
  // Saved statistics came through an account, so they prove the connect step.
  const connected = searchSaved || google === "connected";
  const states: [SeoSetupStepKind, SeoSetupState | "todo"][] = [
    ["page", hasPages ? "done" : "todo"],
    ["connect", connected ? "done" : blocked(syncable)],
    [
      "sync",
      searchSaved
        ? "done"
        : // With a page and the right to sync, the step waits for the account.
          connected || !hasPages || !syncable
          ? blocked(syncable)
          : "waiting",
    ],
    ["check", running ? "running" : blocked(canRequestAnalysis)],
  ];
  const check = states.length - 1;
  // A failed check is only news while the reader can run it again.
  const failed =
    !running && newest?.status === "failed" && states[check][1] === "todo";
  // The failed check comes first: its message asks for a new run.
  const next = failed
    ? check
    : states.findIndex(([, state]) => state === "todo");
  if (next < 0 && !running) return null;
  const steps: SeoSetupStep[] = states.map(([kind, state], index) => ({
    kind,
    state: state === "todo" ? (index === next ? "next" : "open") : state,
  }));
  const countable = steps.filter((step) => step.state !== "unavailable");
  return {
    steps,
    next: next < 0 ? null : steps[next].kind,
    done: countable.filter((step) => step.state === "done").length,
    total: countable.length,
    failed,
    // The connect step cannot say "connect" or "connected" yet.
    checking: !connected && google === "checking" && syncable && hasPages,
  };
}

export type SeoSetup = NonNullable<ReturnType<typeof seoSetup>>;
