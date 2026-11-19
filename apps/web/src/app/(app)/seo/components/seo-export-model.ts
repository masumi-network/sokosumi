import type {
  ProjectSeoAction,
  ProjectSeoSearchQueries,
  TableColumn,
} from "@sokosumi/core-client";
import { createDataTableSchema } from "@sokosumi/utils";
import { tableImportBatches } from "@/app/drive/tables/table-import";
import type { SeoCompetitorSite } from "./seo-competitors-model";
import type { SeoCsvCell } from "./seo-csv";
import { seoFollowUpText } from "./seo-followup-review";
import type { SeoKeywordGroup } from "./seo-keyword-rows-model";
import type { SeoTopPage } from "./seo-search-model";
import type { seoKeyEvents } from "./seo-traffic-model";

/**
 * One table as the CSV writes it: English column names and raw values. `types` names what each column
 * holds, for a copy into a Files Table; a column without one is text.
 */
export type SeoExport = {
  header: string[];
  rows: SeoCsvCell[][];
  types?: TableColumn["type"][];
};
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
    types: ["text", "url", "text", "text", "number", "number", "date", "text"],
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

/**
 * One keyword list with every column it shows: the CSV's columns with Difficulty after the searches. The keywords
 * CSV keeps its columns, for the sheets already built on it.
 */
export function seoKeywordsTableExport(
  groups: SeoKeywordGroup[],
  t: Label,
): SeoExport {
  const { header, types = [], rows } = seoKeywordsExport(groups, t);
  // After "Searches a month", the fifth column.
  const add = <T>(row: T[], difficulty: T) => [
    ...row.slice(0, 5),
    difficulty,
    ...row.slice(5),
  ];
  return {
    header: add(header, t("keywords.difficulty.title")),
    types: add(types, "number"),
    rows: rows.map((row, i) => add(row, groups[i].difficulty)),
  };
}

/** The competitor sites as listed: one row per site, with the page the row shows and its numbers. */
export function seoCompetitorsExport(
  sites: SeoCompetitorSite[],
  t: Label,
): SeoExport {
  return {
    header: [
      t("competitors.site"),
      t("page"),
      t("competitors.rank"),
      t("competitors.backlinks"),
      t("competitors.domainsShort"),
    ],
    types: ["text", "url", "number", "number", "number"],
    rows: sites.map(({ host, lead, best }) => [
      host,
      lead.url,
      best,
      lead.backlinks,
      lead.referringDomains,
    ]),
  };
}

export function seoActionsExport(
  actions: ProjectSeoAction[],
  t: Label,
): SeoExport {
  const hasReviews = actions.some((action) => action.followUpReview);
  const hasDecisions = actions.some((action) => action.decision);
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
      ...(hasReviews ? [t("actions.reviewAgain")] : []),
      ...(hasDecisions
        ? [
            t("actions.alternative"),
            t("actions.nextCheck"),
            t("actions.evidence"),
          ]
        : []),
    ],
    rows: actions.map((action) => [
      action.title,
      action.pageUrl,
      t(`actions.kind.${action.kind}`),
      t(`actions.${action.status}`),
      t(`priority.${action.effort}`),
      action.why,
      action.decision ? null : action.expectedEffect,
      action.edit?.before ?? null,
      action.edit?.after ?? null,
      ...(hasReviews
        ? [
            action.followUpReview
              ? seoFollowUpText(action.followUpReview, t)
              : null,
          ]
        : []),
      ...(hasDecisions
        ? [
            action.decision?.alternative ?? null,
            action.decision?.nextCheck ?? null,
            action.decision ? action.evidence.join("\n") : null,
          ]
        : []),
    ]),
  };
}

const WEB = /^https?:\/\//;
/** Not URL.canParse: Next still supports Safari 16.4, which lacks it. */
function isWebAddress(value: string) {
  if (!WEB.test(value)) return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * One exported table as a new Files Table: the create request and every row in batches of at most 100,
 * keyed by `key`, so a retry with the same plan creates and inserts nothing twice. An empty cell stays empty.
 */
export function seoTablePlan(
  { header, rows, types = [] }: SeoExport,
  source: { title: string; description: string; projectId: string | null },
  key: string,
) {
  const columns = header.map((name, i) => ({
    id: crypto.randomUUID(),
    name,
    // A page that is not a web address keeps the column text: a URL column refuses it.
    type:
      types[i] === "url" &&
      !rows.every((row) => row[i] == null || isWebAddress(String(row[i])))
        ? "text"
        : (types[i] ?? "text"),
  }));
  const table = createDataTableSchema.parse({ key, ...source, columns });
  const insert = rows.map((row) => ({
    values: Object.fromEntries(
      columns.flatMap(({ id }, i) => {
        const value = row[i] ?? null;
        if (value === null) return [];
        return [[id, columns[i].type === "number" ? value : String(value)]];
      }),
    ),
    evidence: {},
  }));
  return { table, batches: tableImportBatches(key, insert) };
}
