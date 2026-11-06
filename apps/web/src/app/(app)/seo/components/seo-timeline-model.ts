import type { ProjectSeoWorkspace } from "@sokosumi/core-client";

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
