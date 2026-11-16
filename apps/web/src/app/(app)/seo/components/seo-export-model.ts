import type {
  ProjectSeoAction,
  ProjectSeoSearchQueries,
} from "@sokosumi/core-client";
import type { SeoCsvCell } from "./seo-csv";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";
import type { SeoTopPage } from "./seo-search-model";
import type { seoKeyEvents } from "./seo-traffic-model";

/** One table as the CSV writes it: translated column names and raw values. */
export type SeoExport = { header: string[]; rows: SeoCsvCell[][] };
/** The translator of the "App.Seo" messages. */
type Label = IntlTranslation<"App.Seo">;

const day = (value: Date | string | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : null;

/** The query rows as listed: the reader's search and sort. A rate stays a fraction, as Search Console exports it. */
export function seoQueriesExport(
  rows: ProjectSeoSearchQueries["rows"],
  t: Label,
): SeoExport {
  return {
    header: [
      t("queries.query"),
      t("page"),
      t("queries.clicks"),
      t("queries.impressions"),
      t("queries.ctr"),
      t("queries.position"),
    ],
    rows: rows.map((row) => [
      row.query,
      row.pageUrl,
      row.clicks,
      row.impressions,
      row.ctr,
      row.averagePosition,
    ]),
  };
}

/**
 * The Top pages rows. With a Google Analytics read, the key events column names its own period:
 * that read can cover another period than the Search Console rows.
 */
export function seoTopPagesExport(
  rows: SeoTopPage[],
  t: Label,
  keyEvents: ReturnType<typeof seoKeyEvents> = null,
): SeoExport {
  const keyEventsCell = (pageUrl: string): SeoCsvCell[] =>
    keyEvents
      ? [
          keyEvents.skipped.has(pageUrl)
            ? t("traffic.keyEventsNotRead")
            : (keyEvents.byPage.get(pageUrl) ?? null),
        ]
      : [];
  return {
    header: [
      t("page"),
      t("queries.clicks"),
      t("queries.impressions"),
      t("queries.ctr"),
      t("queries.position"),
      t("pages.queryCount"),
      ...(keyEvents
        ? [
            `${t(keyEvents.label)} ${keyEvents.period.from}/${keyEvents.period.to}`,
          ]
        : []),
      t("pages.topQuery"),
    ],
    rows: rows.map((row) => [
      row.pageUrl,
      row.clicks,
      row.impressions,
      row.ctr,
      row.averagePosition,
      row.queries,
      ...keyEventsCell(row.pageUrl),
      row.topQuery,
    ]),
  };
}

/**
 * Every checked keyword the search keeps, also the ones behind "Show more". The position is the best rank
 * of the newest check; an empty cell means the page was not in the read results or not read.
 */
export function seoKeywordsExport(
  groups: SeoKeywordGroup[],
  t: Label,
): SeoExport {
  return {
    header: [
      t("keywords.keyword"),
      t("page"),
      t("keywords.country"),
      t("keywords.language"),
      t("keywords.volume"),
      t("keywords.position"),
      t("observed"),
      t("keywords.priority"),
    ],
    rows: groups.map(({ lead, volume, best, reads }) => [
      lead.keyword,
      lead.pageUrl,
      lead.countryCode,
      lead.languageCode,
      volume,
      best,
      day(reads[0]?.observedAt ?? null),
      t(`priority.${lead.priority}`),
    ]),
  };
}

export function seoActionsExport(
  actions: ProjectSeoAction[],
  t: Label,
): SeoExport {
  return {
    header: [
      t("export.action"),
      t("page"),
      t("export.kind"),
      t("export.status"),
      t("actions.effort"),
      t("actions.why"),
      t("actions.effect"),
      t("actions.before"),
      t("actions.after"),
    ],
    rows: actions.map((action) => [
      action.title,
      action.pageUrl,
      t(`actions.kind.${action.kind}`),
      t(`actions.${action.status}`),
      t(`priority.${action.effort}`),
      action.why,
      action.expectedEffect,
      action.edit?.before ?? null,
      action.edit?.after ?? null,
    ]),
  };
}
