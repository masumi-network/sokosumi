import type {
  ProjectSeoObservation,
  ProjectSeoRankPoint,
} from "@sokosumi/database";
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
import { seoRankPointKey } from "./project-seo-rank-points";
import { matchesSeoPeriod, normalizeSeoUrl } from "./project-seo-store";

/**
 * Public results the SERP history reads, newest first. Its own bound: metric syncs and audits share the
 * workspace load, and a daily monitor fills this with about half a year of checks.
 */
export const SEO_RANK_HISTORY_OBSERVATIONS = 200;
/**
 * Result kinds whose Run can read SERPs (`keyword.refresh`): "rankings", and "audit_lite" when it asks for it.
 * A full audit's payload holds up to 10 page Reports, too heavy to load 200 times per workspace read. Its
 * position reads reach the history through the rank point table.
 */
export const SEO_RANK_HISTORY_KINDS = ["rankings", "audit_lite"];
export type SeoRankSource = Pick<
  ProjectSeoObservation,
  "id" | "observedAt" | "payload"
>;
type PositionPoint = NonNullable<
  ProjectSeoWorkspace["keywords"][number]["positionHistory"]
>[number];
type SerpSeries = NonNullable<ProjectSeoWorkspace["serpHistory"]>[number];
/** A stored position read, as the rank point table holds it. */
export type SeoRankPointRow = Pick<
  ProjectSeoRankPoint,
  | "key"
  | "observationId"
  | "observedAt"
  | "position"
  | "positionStatus"
  | "checkedResults"
  | "device"
>;
type Source = { row: SeoRankSource; data: PublicSeoPayload };

const keyOf = (row: ProjectSeoWorkspace["keywords"][number]) =>
  row.observationId && row.pageUrl
    ? seoRankPointKey(
        { ...row, pageUrl: row.pageUrl },
        row.countryCode,
        row.languageCode,
      )
    : null;

/** The rank point keys of the workspace's observed keyword rows: the points its history reads. */
export function seoRankKeys(workspace: ProjectSeoWorkspace): string[] {
  return [...new Set(workspace.keywords.flatMap((row) => keyOf(row) ?? []))];
}

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
 * The rank views over time: each observed keyword row gets the stored paid reads of its keyword, page, device,
 * reason and Market, newest last; a read where the page was not in the checked results stays a point without a
 * position. The SERP reads give one series per keyword, device and Market, and the weekly share of voice.
 */
export function withSeoRankings(
  workspace: ProjectSeoWorkspace,
  rows: SeoRankSource[],
  /** The points of `seoRankKeys(workspace)` in the workspace period: per key the 90 newest and, where older ones exist, one more. */
  points: SeoRankPointRow[] = [],
): ProjectSeoWorkspace {
  const sources = rankSources(workspace, rows);
  return {
    ...workspace,
    keywords: withPositionHistory(workspace.keywords, points),
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
  points: SeoRankPointRow[],
): ProjectSeoWorkspace["keywords"] {
  const history = new Map<string, PositionPoint[]>();
  // Two reads of one time keep one order on every load: by code unit, as the database orders the IDs.
  const oldestFirst = points.toSorted(
    (a, b) =>
      a.observedAt.getTime() - b.observedAt.getTime() ||
      Number(a.observationId > b.observationId) -
        Number(a.observationId < b.observationId),
  );
  for (const point of oldestFirst) {
    const series = history.get(point.key) ?? [];
    series.push({
      observedAt: point.observedAt.toISOString(),
      observationId: point.observationId,
      position: point.position,
      positionStatus: point.positionStatus as PositionPoint["positionStatus"],
      checkedResults: point.checkedResults,
      device: point.device as PositionPoint["device"],
    });
    history.set(point.key, series);
  }
  return keywords.map((row) => {
    const key = keyOf(row);
    const series = key ? history.get(key) : undefined;
    return series
      ? {
          ...row,
          positionHistory: series.slice(-SEO_RANK_HISTORY_POINTS),
          positionHistoryCut: series.length > SEO_RANK_HISTORY_POINTS,
        }
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
        pageUrls: [],
        points: [],
      };
      const page = (url: string) => {
        const key = normalizeSeoUrl(url);
        const index = entry.pageUrls.indexOf(key);
        return index < 0 ? entry.pageUrls.push(key) - 1 : index;
      };
      entry.points.push({
        observedAt: read.observedAt,
        observationId: row.id,
        // The bot reads a citation against every page of the Run together: the point names them all.
        pages: [...new Set(data.pageUrls.map(page))],
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
