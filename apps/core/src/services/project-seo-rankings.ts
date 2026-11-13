import type { ProjectSeoObservation } from "@sokosumi/database";
import {
  type PublicSeoPayload,
  publicSeoPayloadSchema,
} from "@/helpers/project-seo-report";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import { SEO_RANK_HISTORY_POINTS } from "@/schemas/project-seo-rankings.schema";
import { seoKeywordIdentity } from "./project-seo-keyword-rows";
import { matchesSeoPeriod } from "./project-seo-store";

/**
 * Public results the rank history reads, newest first. Its own bound: metric syncs and audits share the
 * workspace load, and a daily monitor fills this with about half a year of checks.
 */
export const SEO_RANK_HISTORY_OBSERVATIONS = 200;
/** Observation kinds that hold no public SEO result. */
export const SEO_NON_RESULT_KINDS = ["metrics", "page_change"];

export type SeoRankSource = Pick<
  ProjectSeoObservation,
  "id" | "observedAt" | "payload"
>;
type PositionPoint = NonNullable<
  ProjectSeoWorkspace["keywords"][number]["positionHistory"]
>[number];

/** The readable results in the workspace period, oldest first. */
function rankSources(workspace: ProjectSeoWorkspace, rows: SeoRankSource[]) {
  const period = {
    from: workspace.scope.from ?? undefined,
    to: workspace.scope.to ?? undefined,
  };
  const sources: Array<{ row: SeoRankSource; data: PublicSeoPayload }> = [];
  for (const row of rows) {
    if (!matchesSeoPeriod(row.observedAt, period)) continue;
    // The workspace load fails on an unreadable result; history only leaves it out.
    const parsed = publicSeoPayloadSchema.safeParse(row.payload);
    if (parsed.success) sources.push({ row, data: parsed.data });
  }
  sources.sort(
    (a, b) => a.row.observedAt.getTime() - b.row.observedAt.getTime(),
  );
  return sources;
}

/**
 * Each observed keyword row gets every loaded paid read of its keyword, page, device, reason and Market,
 * newest last. A read where the page was not in the checked results stays a point without a position.
 */
export function withSeoRankHistory(
  workspace: ProjectSeoWorkspace,
  rows: SeoRankSource[],
): ProjectSeoWorkspace {
  const sources = rankSources(workspace, rows);
  const history = new Map<string, PositionPoint[]>();
  for (const { row, data } of sources) {
    const seen = new Set<string>();
    // A keyword of an unselected page has another identity: no workspace row asks for it.
    for (const item of data.keywords) {
      const identity = seoKeywordIdentity(
        item,
        data.countryCode,
        data.languageCode,
      );
      // The workspace row is the first match of a result; so is its point.
      if (seen.has(identity)) continue;
      seen.add(identity);
      history.set(identity, [
        ...(history.get(identity) ?? []),
        {
          observedAt: item.observedAt,
          observationId: row.id,
          position: item.position,
          positionStatus: item.positionStatus,
          device: item.device,
        },
      ]);
    }
  }
  return {
    ...workspace,
    keywords: workspace.keywords.map((row) => {
      if (!row.observationId || !row.pageUrl) return row;
      const points = history.get(
        seoKeywordIdentity(
          { ...row, pageUrl: row.pageUrl },
          row.countryCode,
          row.languageCode,
        ),
      );
      return points
        ? { ...row, positionHistory: points.slice(-SEO_RANK_HISTORY_POINTS) }
        : row;
    }),
  };
}
