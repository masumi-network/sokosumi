import type {
  ProjectSeoActionTask,
  ProjectSeoObservation,
} from "@sokosumi/database";
import { SEO_STATS_MAX_DAYS } from "@/lib/seo/native-statistics";
import { searchOpportunities } from "@/lib/seo/search-opportunities";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import type { NativeSeoMetrics } from "@/schemas/project-seo-native-metrics.schema";

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

/** The country and device split of a sync. Discover and Google News store it under the feed keys. */
function splitOf(data: NativeSeoMetrics) {
  const countries = data.countries ?? data.feedCountries;
  const devices = data.devices ?? data.feedDevices;
  return countries || devices ? { countries, devices } : null;
}

const DAY_MS = 86_400_000;
function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/**
 * The daily positions of one sync, with older days from earlier syncs of the
 * same property. Per keyword and country, an earlier sync adds days only while
 * its period touches the days already read, so no day from `from` on is unread.
 * The sync itself supplies each of its days. An older day comes from the sync
 * with the latest last day. At most 366 days are kept.
 */
export function mergedKeywordSeries(
  current: SearchEvidenceSource,
  sources: SearchEvidenceSource[],
): NativeSeoMetrics["keywordSeries"] {
  const series = current.data.keywordSeries;
  if (!series) return undefined;
  const floor = shiftDay(current.data.to, 1 - SEO_STATS_MAX_DAYS);
  const older = sources
    .filter(
      (source) =>
        source !== current &&
        source.data.keywordSeries &&
        source.data.propertyId === current.data.propertyId,
    )
    .sort((a, b) => b.data.to.localeCompare(a.data.to));
  let truncated = series.truncated;
  const keywords = series.keywords.map((entry) => {
    let from = current.data.from;
    const points = [...entry.points];
    for (const source of older) {
      // Sources come latest last day first: once one ends before the read days, all later ones do.
      if (from <= floor || source.data.to < shiftDay(from, -1)) break;
      const match = source.data.keywordSeries?.keywords.find(
        (item) =>
          item.keyword === entry.keyword &&
          item.countryCode === entry.countryCode,
      );
      if (!match || source.data.from >= from) continue;
      const first = source.data.from < floor ? floor : source.data.from;
      points.push(
        ...match.points.filter(
          (point) => point.date >= first && point.date < from,
        ),
      );
      from = first;
      truncated ||= source.data.keywordSeries?.truncated === true;
    }
    return {
      ...entry,
      ...(from < current.data.from && { from }),
      points: points.sort((a, b) => a.date.localeCompare(b.date)),
    };
  });
  return { ...series, truncated, keywords };
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
  searchBreakdown: ProjectSeoWorkspace["searchBreakdown"];
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
  // Beside query rows, the split comes from the same sync. Discover and Google
  // News sync a split but no query rows, so there the newest split stands alone.
  const split = current ?? sources.find((source) => splitOf(source.data));
  const parts = split && splitOf(split.data);
  const searchBreakdown =
    split && parts
      ? {
          observationId: split.row.id,
          propertyId: split.data.propertyId,
          from: split.data.from,
          to: split.data.to,
          observedAt:
            split.data.collectedAt ?? split.row.observedAt.toISOString(),
          ...parts,
        }
      : null;
  if (!current?.data.queries)
    return { searchQueries: null, searchBreakdown, actions };
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
      observedAt:
        current.data.collectedAt ?? current.row.observedAt.toISOString(),
      rowLimit: current.data.queries.rowLimit,
      truncated: current.data.queries.truncated,
      rows: current.data.queries.rows.map((row, index) => ({
        ...row,
        id: `${current.row.id}:query:${index}`,
      })),
      keywordSeries: mergedKeywordSeries(current, sources),
      ...(current.data.searchType && { searchType: current.data.searchType }),
    },
    searchBreakdown,
    actions,
  };
}
