import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import { seoStatisticsLostData } from "@sokosumi/utils";
import { seoCoverageIsNews } from "./seo-statistics-model";

type Observation = ProjectSeoWorkspace["observations"][number];
type Event = ProjectSeoWorkspace["timeline"][number];

export type SeoTimelineNode = {
  event: Event;
  observation: Observation | undefined;
  at: string | Date;
  isRecheck: boolean;
  label:
    | "auditRun"
    | "checkRun"
    | "recheckRun"
    | "resultsSaved"
    | "analysisRequested"
    | "metricsSynced"
    | "actionLinked"
    | "scopeChanged"
    | "pageChanged";
};

function timestamp(value: string | Date): number {
  return new Date(value).getTime();
}

function comparisonKey(observation: Observation): string | null {
  if (
    // Other report kinds can vary keywords, competitors or selected modules.
    // Those inputs are not exposed in this view's observation contract.
    observation.kind !== "page_check" ||
    observation.coverage.checked === 0 ||
    !observation.countryCode ||
    !observation.languageCode ||
    !observation.rulebookVersion ||
    observation.devices.length === 0 ||
    observation.pageIds.length === 0
  )
    return null;
  return JSON.stringify([
    observation.kind,
    observation.scopeVersion,
    [...observation.pageIds].sort(),
    observation.countryCode,
    observation.languageCode,
    [...observation.devices].sort(),
    observation.rulebookVersion,
  ]);
}

/** Use the check time for results, not the time its report was saved. */
export function buildSeoTimeline(
  workspace: ProjectSeoWorkspace,
): SeoTimelineNode[] {
  const observations = new Map(
    workspace.observations.map((observation) => [observation.id, observation]),
  );
  const firstChecks = new Map<string, number>();
  for (const observation of workspace.observations) {
    const key = comparisonKey(observation);
    if (!key) continue;
    const at = timestamp(observation.observedAt);
    firstChecks.set(key, Math.min(firstChecks.get(key) ?? at, at));
  }
  return workspace.timeline
    .map((event): SeoTimelineNode => {
      const observation = event.observationId
        ? observations.get(event.observationId)
        : undefined;
      const isCheck = event.kind === "audit" || event.kind === "check";
      const check = isCheck ? observation : undefined;
      const key = check ? comparisonKey(check) : null;
      const isRecheck = Boolean(
        check &&
          key &&
          (firstChecks.get(key) ?? Infinity) < timestamp(check.observedAt),
      );
      const label =
        event.kind === "metrics"
          ? "metricsSynced"
          : event.kind === "action"
            ? "actionLinked"
            : event.kind === "scope"
              ? "scopeChanged"
              : event.kind === "page_change"
                ? "pageChanged"
                : !check
                  ? event.observationId
                    ? "resultsSaved"
                    : "analysisRequested"
                  : isRecheck
                    ? "recheckRun"
                    : event.kind === "audit"
                      ? "auditRun"
                      : "checkRun";
      return {
        event,
        observation: check,
        at: check?.observedAt ?? event.at,
        isRecheck,
        label,
      };
    })
    .sort(
      (left, right) =>
        timestamp(left.at) - timestamp(right.at) ||
        left.event.id.localeCompare(right.event.id),
    );
}

/**
 * Newest-first nodes with each run of back-to-back statistics syncs folded into
 * its newest sync. A sync from another source or with another status starts a
 * new run, so a failure stays visible.
 */
export function foldSyncRuns(nodes: SeoTimelineNode[]) {
  const folded: (SeoTimelineNode & { syncs: number })[] = [];
  for (const node of nodes) {
    const previous = folded.at(-1);
    if (
      previous &&
      node.event.kind === "metrics" &&
      previous.event.kind === "metrics" &&
      // The title names the source, so Analytics and Search Console runs stay apart.
      previous.event.title === node.event.title &&
      previous.event.status === node.event.status
    )
      previous.syncs += 1;
    else folded.push({ ...node, syncs: 1 });
  }
  return folded;
}

/**
 * Newest-first nodes with back-to-back clean checks of the same pages folded into
 * the newest one. Four rows of "No issues found" say one thing; the folded row
 * keeps the earlier checks for its details.
 */
export function foldCleanChecks<T extends SeoTimelineNode>(
  nodes: T[],
  clean: (node: T) => boolean,
) {
  // Only checks that differ in nothing but time and rule count fold together.
  const sameRun = (node: T) =>
    JSON.stringify([
      node.event.kind,
      node.observation?.countryCode,
      node.observation?.languageCode,
      [...(node.observation?.devices ?? [])].sort(),
      [...(node.observation?.pageIds ?? [])].sort(),
    ]);
  const folded: (T & { earlier: T[] })[] = [];
  for (const node of nodes) {
    const previous = folded.at(-1);
    if (
      previous &&
      clean(previous) &&
      clean(node) &&
      sameRun(previous) === sameRun(node)
    )
      previous.earlier.push(node);
    else folded.push({ ...node, earlier: [] });
  }
  return folded;
}

/**
 * A run leads with what it found; "no issues" needs a complete run that measured something.
 * Its issue count covers only the viewed pages, so a run with other pages shows no result.
 */
export function seoNodeResult(
  workspace: Pick<ProjectSeoWorkspace, "scope">,
  { observation }: Pick<SeoTimelineNode, "observation">,
) {
  if (!observation || observation.coverage.checked === 0) return null;
  if (!observation.pageIds.every((id) => workspace.scope.pageIds.includes(id)))
    return null;
  const incomplete =
    observation.coverage.failed > 0 ||
    (observation.coverage.modules?.failed ?? 0) > 0;
  return observation.issues > 0 || !incomplete ? observation.issues : null;
}

/**
 * What happened at each stop of the runs row, newest first: the checks, page changes, Tasks and failed syncs after
 * the UTC day of the stop before it, through its own day. The newest stop has no end, so it also holds what came
 * after its check; the oldest has no start, so it also holds the days older than the row shows. `days` are the UTC
 * days of the stops, newest first.
 */
export function seoStops(workspace: ProjectSeoWorkspace, days: string[]) {
  // Metric ids are "<sync id>:<metric key>"; a sync event carries the sync id.
  const syncs = new Map(
    workspace.metrics.map((metric) => [metric.id.split(":")[0], metric]),
  );
  // Older syncs keep no metrics; their title still names the source.
  const titleSources = new Map(
    workspace.timeline.flatMap((event) => {
      const sync = syncs.get(event.observationId ?? "");
      return event.kind === "metrics" && sync
        ? [[event.title, sync.source] as const]
        : [];
    }),
  );
  /**
   * A routine sync is housekeeping; "Last synced" on the Performance card already says when.
   * Only a sync that failed or lost data is history worth a row. Search Console's usual
   * filtering is not news (seoCoverageIsNews); an older Search Console sync without saved
   * metrics is judged by the notes in its detail.
   */
  function syncIsNews(event: Event) {
    const status = event.status.toLowerCase();
    if (status === "failed" || status === "unavailable") return true;
    if (status !== "partial") return false;
    const sync = syncs.get(event.observationId ?? "");
    return sync
      ? seoCoverageIsNews(sync)
      : titleSources.get(event.title) !== "search_console" ||
          seoStatisticsLostData(event.detail);
  }
  // A later routine sync of the same source recovered any older failure; the title names the source.
  const lastRoutine = new Map<string, number>();
  for (const event of workspace.timeline)
    if (event.kind === "metrics" && !syncIsNews(event))
      lastRoutine.set(
        event.title,
        Math.max(lastRoutine.get(event.title) ?? 0, timestamp(event.at)),
      );
  const news = buildSeoTimeline(workspace)
    .reverse()
    .filter(
      ({ event }) =>
        event.kind !== "metrics" ||
        (syncIsNews(event) &&
          timestamp(event.at) > (lastRoutine.get(event.title) ?? 0)),
    );
  return new Map(
    days.map((day, index) => {
      const after = days[index + 1] ?? null;
      const through = index === 0 ? null : day;
      const inStop = news.filter(({ at }) => {
        const atDay = new Date(at).toISOString().slice(0, 10);
        return (
          (after === null || atDay > after) &&
          (through === null || atDay <= through)
        );
      });
      // Open failures fold into one row, and so do back-to-back clean checks.
      const nodes = foldCleanChecks(
        foldSyncRuns(inStop),
        (node) => seoNodeResult(workspace, node) === 0,
      );
      return [day, { after, newest: index === 0, nodes }] as const;
    }),
  );
}

export type SeoStopNode =
  ReturnType<typeof seoStops> extends Map<string, { nodes: (infer Node)[] }>
    ? Node
    : never;

/** What the hover card of a stop counts: its checks, the newest of them, and the events beside them. */
export function seoStopDigest(nodes: SeoStopNode[]) {
  const count = (counts: (node: SeoStopNode) => boolean) =>
    nodes.reduce(
      (sum, node) =>
        counts(node) ? sum + node.syncs * (1 + node.earlier.length) : sum,
      0,
    );
  // As on the rows: "unavailable" is a failure for a sync only, which read nothing.
  const failed = ({ event }: SeoStopNode) => {
    const status = event.status.toLowerCase();
    return (
      status === "failed" ||
      (event.kind === "metrics" && status === "unavailable")
    );
  };
  const isCheck = ({ event }: SeoStopNode) =>
    event.kind === "check" || event.kind === "audit";
  // A request with no results yet is not a check: its row says it is running or failed.
  const checks = nodes.reduce(
    (sum, node) =>
      node.observation && isCheck(node) ? sum + 1 + node.earlier.length : sum,
    0,
  );
  return {
    checks,
    newestCheck: nodes.find(({ observation }) => observation !== undefined),
    failedChecks: count(
      (node) => !node.observation && isCheck(node) && failed(node),
    ),
    pageChanges: count(({ event }) => event.kind === "page_change"),
    scopeChanges: count(({ event }) => event.kind === "scope"),
    tasks: count(({ event }) => event.kind === "action"),
    // A partial sync is news too, but not a failure: its row in the details says what it lost.
    failedSyncs: count((node) => node.event.kind === "metrics" && failed(node)),
  };
}
