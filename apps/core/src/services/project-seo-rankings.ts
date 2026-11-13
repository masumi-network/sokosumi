import type { ProjectSeoObservation } from "@sokosumi/database";
import {
  type PublicSeoPayload,
  publicSeoPayloadSchema,
} from "@/helpers/project-seo-report";
import { SEO_CTR_SOURCE } from "@/lib/seo/keyword-clicks";
import { seoShareOfVoice } from "@/lib/seo/share-of-voice";
import type { ProjectSeoWorkspace } from "@/schemas/project-seo.schema";
import {
  SEO_RANK_HISTORY_POINTS,
  SEO_SERP_SERIES_MAX,
} from "@/schemas/project-seo-rankings.schema";
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
type SerpSeries = NonNullable<ProjectSeoWorkspace["serpHistory"]>[number];
type Source = { row: SeoRankSource; data: PublicSeoPayload };

/** The readable results in the workspace period, oldest first. */
function rankSources(workspace: ProjectSeoWorkspace, rows: SeoRankSource[]) {
  const period = {
    from: workspace.scope.from ?? undefined,
    to: workspace.scope.to ?? undefined,
  };
  const sources: Source[] = [];
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
 * The rank views over time: each observed keyword row gets every loaded paid read of its keyword, page, device,
 * reason and Market, newest last; a read where the page was not in the checked results stays a point without a
 * position. The SERP reads give one series per keyword, device and Market, and the weekly share of voice.
 */
export function withSeoRankings(
  workspace: ProjectSeoWorkspace,
  rows: SeoRankSource[],
): ProjectSeoWorkspace {
  const sources = rankSources(workspace, rows);
  return {
    ...workspace,
    keywords: withPositionHistory(workspace.keywords, sources),
    serpHistory: serpHistory(sources),
    shareOfVoice: shareOfVoice(workspace, sources),
  };
}

/** The site is the hosts of the selected pages; the rivals are the confirmed competitors. */
function shareOfVoice(
  workspace: ProjectSeoWorkspace,
  sources: Source[],
): ProjectSeoWorkspace["shareOfVoice"] {
  const pageIds = new Set(workspace.scope.pageIds);
  const host = (url: string) => new URL(url).hostname;
  const weeks = seoShareOfVoice(
    sources.flatMap(({ data }) =>
      (data.serps ?? []).map((read) => ({
        ...read,
        countryCode: data.countryCode,
        languageCode: data.languageCode,
      })),
    ),
    workspace.pages
      .filter((page) => pageIds.has(page.id))
      .map((page) => host(page.url)),
    workspace.competitors
      .filter((row) => row.role === "competitor" && row.confirmed)
      .map((row) => host(row.url)),
  );
  return weeks.length ? { ctrSource: SEO_CTR_SOURCE, weeks } : null;
}

function withPositionHistory(
  keywords: ProjectSeoWorkspace["keywords"],
  sources: Source[],
): ProjectSeoWorkspace["keywords"] {
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
  return keywords.map((row) => {
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
  });
}

/** One series per keyword, device and Market; the series with the newest reads first when they pass the cap. */
function serpHistory(sources: Source[]): SerpSeries[] {
  const series = new Map<string, SerpSeries>();
  for (const { row, data } of sources) {
    const seen = new Set<string>();
    for (const read of data.serps ?? []) {
      const identity = JSON.stringify([
        read.keyword.normalize("NFKC").toLowerCase(),
        read.device,
        data.countryCode,
        data.languageCode,
      ]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const entry = series.get(identity) ?? {
        keyword: read.keyword,
        device: read.device,
        countryCode: data.countryCode,
        languageCode: data.languageCode,
        points: [],
      };
      entry.points.push({
        observedAt: read.observedAt,
        observationId: row.id,
        itemTypes: read.itemTypes,
        aiOverview: read.aiOverview,
        featured: read.featured,
        paaOwned: read.paaOwned,
        suspect: read.suspect,
      });
      series.set(identity, entry);
    }
  }
  const last = (entry: SerpSeries) => entry.points.at(-1)?.observedAt ?? "";
  return [...series.values()]
    .sort((a, b) => last(b).localeCompare(last(a)))
    .slice(0, SEO_SERP_SERIES_MAX)
    .map((entry) => ({
      ...entry,
      points: entry.points.slice(-SEO_RANK_HISTORY_POINTS),
    }));
}
