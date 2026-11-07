import type {
  ProjectSeoActionTask,
  ProjectSeoObservation,
} from "@sokosumi/database";
import { searchOpportunities } from "@/lib/seo/search-opportunities";
import type {
  NativeSeoMetrics,
  ProjectSeoWorkspace,
} from "@/schemas/project-seo.schema";

export interface SearchEvidenceSource {
  row: ProjectSeoObservation;
  data: NativeSeoMetrics;
}

function opportunitiesFor(source: SearchEvidenceSource) {
  return searchOpportunities({
    propertyId: source.data.propertyId,
    from: source.data.from,
    to: source.data.to,
    rows: source.data.queries?.rows ?? [],
  });
}

/**
 * Query rows come from the newest compatible Search Console sync. Opportunity IDs
 * hash query and page, so a linked Task stays attached across later syncs, scopes
 * and rule changes, and the same opportunity is never offered twice.
 */
export function projectSearchEvidence(
  sources: SearchEvidenceSource[],
  actionTasks: ProjectSeoActionTask[],
  taskStatuses: Map<string, string>,
): {
  searchQueries: ProjectSeoWorkspace["searchQueries"];
  actions: ProjectSeoWorkspace["actions"];
} {
  const byId = new Map(sources.map((source) => [source.row.id, source]));
  const actions: ProjectSeoWorkspace["actions"] = [];
  const seen = new Set<string>();
  const links = actionTasks
    .filter((link) => byId.has(link.observationId))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const link of links) {
    const source = byId.get(link.observationId);
    const item = source
      ? opportunitiesFor(source).find((row) => row.id === link.actionId)
      : undefined;
    if (!source || !item || seen.has(item.id)) continue;
    seen.add(item.id);
    actions.push({
      ...item,
      observationId: source.row.id,
      taskId: link.taskId,
      status:
        taskStatuses.get(link.taskId) === "COMPLETED"
          ? "implemented"
          : "task_created",
    });
  }
  const current = sources.find((source) => source.data.queries);
  if (!current?.data.queries) return { searchQueries: null, actions };
  // A Task linked from an observation outside this scope still covers the same opportunity.
  const linkByAction = new Map<string, ProjectSeoActionTask>();
  for (const link of [...actionTasks].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  ))
    if (!linkByAction.has(link.actionId)) linkByAction.set(link.actionId, link);
  for (const item of opportunitiesFor(current)) {
    if (seen.has(item.id)) continue;
    const link = linkByAction.get(item.id);
    actions.push({
      ...item,
      observationId: link?.observationId ?? current.row.id,
      taskId: link?.taskId ?? null,
      status: !link
        ? "recommended"
        : taskStatuses.get(link.taskId) === "COMPLETED"
          ? "implemented"
          : "task_created",
    });
  }
  return {
    searchQueries: {
      observationId: current.row.id,
      propertyId: current.data.propertyId,
      from: current.data.from,
      to: current.data.to,
      timeZone: current.data.timeZone,
      observedAt: current.row.observedAt.toISOString(),
      rowLimit: current.data.queries.rowLimit,
      truncated: current.data.queries.truncated,
      rows: current.data.queries.rows.map((row, index) => ({
        ...row,
        id: `${current.row.id}:query:${index}`,
      })),
    },
    actions,
  };
}
