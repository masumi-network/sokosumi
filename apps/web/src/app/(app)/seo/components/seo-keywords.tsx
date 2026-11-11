"use client";

import { Plus } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { SeoKeywordIdeas } from "./seo-keyword-ideas";
import {
  keywordGroups,
  keywordPage,
  keywordPositions,
  keywordReadFailed,
  keywordSummary,
} from "./seo-keyword-rows-model";
import { SeoKeywordSuggestions } from "./seo-keyword-suggestions";
import {
  SeoKeywordTrendChart,
  SeoKeywordTrendToggle,
} from "./seo-keyword-trend";
import {
  keywordSuggestions,
  keywordTrend,
  normalizeQuery,
  searchConsoleIndex,
} from "./seo-search-model";
import {
  SEO_COMPACT_ROWS_CLASS,
  SEO_LIST_PAGE_SIZE,
  SEO_SEARCH_MIN_ROWS,
  SeoBarNumber,
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  type SeoRankingsSection,
  SeoSection,
  SeoShowMore,
  SeoSource,
  SeoState,
  seoMarketName,
  seoSectionClass,
  seoSiteUrl,
} from "./seo-shared";
import { seoQueryPeriod } from "./seo-statistics-model";
import { SeoKeywordDemand, SeoStrategyCard } from "./seo-strategy";
import { seoStrategyGroupOf } from "./seo-strategy-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** One filter for search queries and tracked keywords; it shows once a list is long enough to need it. */
export function SeoQueryFilter({
  model,
  rows,
}: {
  model: SeoWorkspaceModel;
  rows: number;
}) {
  const t = useTranslations("App.Seo");
  if (rows < SEO_SEARCH_MIN_ROWS && !model.keywordSearch) return null;
  return (
    <div>
      <Label className="sr-only" htmlFor="seo-keyword-search">
        {t("search")}
      </Label>
      <Input
        id="seo-keyword-search"
        type="search"
        value={model.keywordSearch}
        onChange={(event) => model.setKeywordSearch(event.target.value)}
        placeholder={t(
          model.data.searchQueries?.rows.length
            ? "keywords.searchPlaceholder"
            : "keywords.searchKeywords",
        )}
      />
    </div>
  );
}

export function SeoKeywords({
  model,
  section = "keywords",
}: {
  model: SeoWorkspaceModel;
  /** The list of the Rankings tab that shows. */
  section?: SeoRankingsSection;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const locale = useLocale();
  // One row per keyword: a check reports it once per device, and again as a gap or an idea.
  const { checked, ideas } = keywordGroups(model.filteredKeywords);
  // The result line speaks for every keyword; a search narrows the rows only.
  const all = keywordGroups(model.data.keywords);
  const summary = keywordSummary(all.checked);
  const [expanded, setExpanded] = useState(false);
  const page = keywordPage(checked, SEO_LIST_PAGE_SIZE);
  // A search already narrows the list; it shows every match.
  const rows = expanded || model.keywordSearch ? checked : page.rows;
  const queries = model.data.searchQueries;
  const averages = queries ? searchConsoleIndex(queries.rows) : null;
  // An empty list starts from the searches Google already reports; a search that matched nothing does not.
  const suggestions =
    model.data.keywords.length === 0 && model.data.availableActions.canEdit
      ? keywordSuggestions(model.filteredQueries)
      : [];
  const markets = new Set(
    model.data.keywords.map((row) => `${row.countryCode}:${row.languageCode}`),
  );
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    volume: checked.some((group) => group.volume !== null),
    intent: checked.some((group) => group.intent !== null),
    // Where no keyword shows a page, the result line says so once; a column of "Not found" adds nothing.
    // The column also dates each row, so it stays while the reads come from more than one check.
    position: !(
      all.checked.length > 0 &&
      all.checked.every(
        (group) =>
          group.reads.length > 0 &&
          group.best === null &&
          group.reads[0].observationId === summary.newest?.observationId,
      )
    ),
    // One market for every keyword is said once, in the result line above the table.
    market: markets.size > 1 || !summary.read,
    // The same priority on every keyword tells nothing; the edit dialog still sets it.
    // All keywords decide, so a search does not hide the column.
    priority: new Set(model.data.keywords.map((row) => row.priority)).size > 1,
  };
  const hidden = [
    shown.volume ? null : t("keywords.volume"),
    shown.intent ? null : t("keywords.intent"),
  ].filter((label): label is string => label !== null);
  // Without paid search data these columns can never fill, so nothing names them.
  const paidOff = model.data.availableActions.canUsePaidSearchData !== true;
  // A state label only helps when the list mixes tracked and found keywords.
  const mixed = new Set(checked.map((group) => group.lead.saved)).size > 1;
  const manyPages = model.data.scope.pageIds.length > 1;
  // One keyword's daily positions open at a time, in a full-width row under it.
  const [trendOpen, setTrendOpen] = useState<string | null>(null);
  const columns =
    2 +
    Number(shown.position) +
    Number(shown.market) +
    Number(shown.volume) +
    Number(shown.intent) +
    Number(shown.priority);
  const first = model.data.keywords[0];
  // The bars set each keyword against the most searched one of the list.
  const mostSearched = Math.max(
    0,
    ...checked.map((group) => group.volume ?? 0),
  );
  const noIntent = rows.filter((group) => group.intent === null).length;
  const groupOf = seoStrategyGroupOf(model.data.strategy);
  // One search box filters keywords and ideas: while it holds text, both lists show their matches.
  const bothLists = Boolean(model.keywordSearch) && section !== "competitors";
  return (
    <div className="space-y-5">
      <div
        className={cn("space-y-5", seoSectionClass(section !== "competitors"))}
      >
        <SeoStrategyCard model={model} />
        {/* The lists show a keyword once, so the search counts keywords, not device rows. */}
        <SeoQueryFilter
          model={model}
          rows={all.checked.length + all.ideas.length}
        />
      </div>
      <div className={seoSectionClass(bothLists || section === "keywords")}>
        <SeoSection
          title={t("keywords.title")}
          actions={
            model.data.availableActions.canEdit ? (
              <Button size="sm" onClick={() => model.setDialog("keyword")}>
                <Plus className="size-4" />
                {t("keywords.addButton")}
              </Button>
            ) : null
          }
        >
          {summary.read ? (
            // The result first: one sentence, then the market and the date the rows no longer repeat.
            <div className="space-y-0.5 px-2 pb-1">
              <p className="text-base font-semibold text-balance">
                {t("keywords.summary", {
                  found: summary.found,
                  read: summary.read,
                })}
              </p>
              <p className="text-muted-foreground flex flex-wrap gap-x-2 text-sm">
                {summary.found ? (
                  <span>
                    {t("keywords.firstPage", { count: summary.firstPage })}
                  </span>
                ) : null}
                {!shown.market && first ? (
                  <span>
                    {seoMarketName(
                      locale,
                      first.countryCode,
                      first.languageCode,
                    )}
                  </span>
                ) : null}
                {summary.newest ? (
                  <span>
                    {t("keywords.readOn")}{" "}
                    <SeoDate day value={summary.newest.observedAt} />
                  </span>
                ) : null}
                {summary.newest?.observationId ? (
                  <SeoSource
                    workspace={model.data}
                    observationId={summary.newest.observationId}
                  />
                ) : null}
                {summary.depth ? (
                  <span>
                    {t("summary.depth", {
                      ...summary.depth,
                      same:
                        summary.depth.min === summary.depth.max ? "yes" : "no",
                    })}
                  </span>
                ) : null}
              </p>
            </div>
          ) : null}
          {paidOff ||
          !rows.length ||
          !model.data.availableActions.canEdit ? null : (
            // Under the result and over the rows that carry the buttons: what a click on "Track" gives.
            <p className="text-muted-foreground px-2 pb-1 text-sm">
              {t("keywords.help")}
            </p>
          )}
          {rows.length ? (
            <div className={HOLDER_ITEM_CLASS}>
              <Table className={SEO_COMPACT_ROWS_CLASS}>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {t(
                        manyPages
                          ? "keywords.keywordAndPage"
                          : "keywords.keyword",
                      )}
                    </TableHead>
                    {shown.market ? (
                      <TableHead>{t("keywords.market")}</TableHead>
                    ) : null}
                    {shown.volume ? (
                      <TableHead className="text-right">
                        {t("keywords.volume")}
                      </TableHead>
                    ) : null}
                    {shown.position ? (
                      <TableHead>{t("keywords.position")}</TableHead>
                    ) : null}
                    {shown.intent ? (
                      <TableHead>{t("keywords.intent")}</TableHead>
                    ) : null}
                    {shown.priority ? (
                      <TableHead>{t("keywords.priority")}</TableHead>
                    ) : null}
                    <TableHead>
                      <span className="sr-only">{t("queries.rowActions")}</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ lead: row, reads, volume, intent, sources }) => {
                    const target = model.data.pages.find(
                      (page) => page.id === row.targetPageId,
                    );
                    // Only an unmeasured position falls back to the Search Console period average.
                    const average = reads.length
                      ? undefined
                      : averages?.get(normalizeQuery(row.keyword));
                    // Daily positions are read for tracked keywords only.
                    const trend = row.saved
                      ? keywordTrend(queries, row.keyword, row.countryCode)
                      : ({ state: "absent" } as const);
                    const trendId = `seo-keyword-trend-${row.id}`;
                    // Without a rank or a listed average, the position cell says "no impressions"; the line under the keyword would repeat it.
                    const cellSaysEmpty =
                      trend.state === "empty" &&
                      !reads.length &&
                      Boolean(queries) &&
                      !average?.averagePosition;
                    return (
                      <Fragment key={row.id}>
                        <TableRow>
                          <TableCell className="min-w-48 whitespace-normal">
                            <p className="font-medium break-words">
                              <bdi>{row.keyword}</bdi>
                            </p>
                            {/* In a one-page scope the page link only repeats; "any page" still says something. */}
                            {row.pageUrl ? (
                              manyPages ? (
                                <SeoPageLink
                                  url={row.pageUrl}
                                  site={seoSiteUrl(model.data)}
                                />
                              ) : null
                            ) : (
                              <span className="text-muted-foreground text-sm">
                                {t("keywords.anyPage")}
                              </span>
                            )}
                            {/* One page in scope: the target can only be that page. */}
                            {row.version > 0 && manyPages ? (
                              <p className="text-muted-foreground mt-1 text-xs">
                                {t("keywords.target")}:{" "}
                                {target?.label ||
                                  target?.url ||
                                  t("keywords.anyPage")}
                              </p>
                            ) : null}
                            <SeoKeywordDemand
                              group={groupOf(row)}
                              keyword={row.keyword}
                            />
                            <SeoKeywordTrendToggle
                              trend={
                                cellSaysEmpty ? { state: "absent" } : trend
                              }
                              open={trendOpen === row.id}
                              controls={trendId}
                              onToggle={() =>
                                setTrendOpen((open) =>
                                  open === row.id ? null : row.id,
                                )
                              }
                            />
                            {mixed ? (
                              <div className="mt-1">
                                <SeoState>
                                  {t(
                                    row.saved
                                      ? "keywords.saved"
                                      : "keywords.discovered",
                                  )}
                                </SeoState>
                              </div>
                            ) : null}
                          </TableCell>
                          {shown.market ? (
                            <TableCell data-label={t("keywords.market")}>
                              {seoMarketName(
                                locale,
                                row.countryCode,
                                row.languageCode,
                              )}
                            </TableCell>
                          ) : null}
                          {shown.volume ? (
                            <TableCell
                              className="text-right tabular-nums"
                              data-label={t("keywords.volume")}
                            >
                              {volume === null ? (
                                t("none")
                              ) : (
                                <SeoBarNumber
                                  value={volume}
                                  max={mostSearched}
                                />
                              )}
                            </TableCell>
                          ) : null}
                          {shown.position ? (
                            <TableCell
                              className="whitespace-normal tabular-nums"
                              data-label={t("keywords.position")}
                            >
                              {reads.length ? (
                                <>
                                  {keywordPositions(reads).map((line) => (
                                    <p
                                      key={line.device ?? "all"}
                                      className="whitespace-nowrap"
                                    >
                                      {line.device ? (
                                        <span className="text-muted-foreground">
                                          {t(`analysis.${line.device}`)}:{" "}
                                        </span>
                                      ) : null}
                                      {line.position !== null
                                        ? format.number(line.position)
                                        : t("keywords.notFound")}
                                    </p>
                                  ))}
                                  {/* The result line dates the newest check; a row from an older one carries its own date. */}
                                  {reads[0].observedAt &&
                                  reads[0].observationId !==
                                    summary.newest?.observationId ? (
                                    <p className="text-muted-foreground text-xs">
                                      {t("observed")}:{" "}
                                      <SeoDate value={reads[0].observedAt} />
                                    </p>
                                  ) : null}
                                </>
                              ) : queries && average?.averagePosition ? (
                                <>
                                  <p>
                                    {t("keywords.searchConsoleAverage", {
                                      position: format.number(
                                        average.averagePosition,
                                        {
                                          minimumFractionDigits: 1,
                                          maximumFractionDigits: 1,
                                        },
                                      ),
                                      count: average.impressions,
                                    })}
                                  </p>
                                  <p className="text-muted-foreground text-xs">
                                    {t("keywords.searchConsoleNote")} ·{" "}
                                    <SeoPeriod
                                      {...seoQueryPeriod(
                                        queries,
                                        model.data.metrics,
                                      )}
                                    />
                                    {queries.truncated
                                      ? ` · ${t("queries.truncated", { count: queries.rowLimit })}`
                                      : null}
                                  </p>
                                </>
                              ) : queries ? (
                                // Absent from the listed rows is not zero: Google hides rare searches.
                                <>
                                  <p>
                                    {/* The daily read asks for this keyword alone: no rows means no impressions. */}
                                    {cellSaysEmpty
                                      ? t("keywords.trendEmpty")
                                      : queries.truncated
                                        ? t("keywords.notInKeptRows", {
                                            count: queries.rowLimit,
                                          })
                                        : t("keywords.notListed")}
                                  </p>
                                  <p className="text-muted-foreground text-xs">
                                    <SeoPeriod
                                      {...seoQueryPeriod(
                                        queries,
                                        model.data.metrics,
                                      )}
                                    />
                                  </p>
                                </>
                              ) : (
                                t(
                                  keywordReadFailed({ reads, sources })
                                    ? "keywords.readFailed"
                                    : "keywords.unavailable",
                                )
                              )}
                            </TableCell>
                          ) : null}
                          {shown.intent ? (
                            // No intent in the keyword data: the cell stays empty and the line under the table counts them.
                            <TableCell data-label={t("keywords.intent")}>
                              {intent}
                            </TableCell>
                          ) : null}
                          {shown.priority ? (
                            <TableCell data-label={t("keywords.priority")}>
                              {t(`priority.${row.priority}`)}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            {model.data.availableActions.canEdit ? (
                              <div className="flex flex-wrap justify-end gap-2 max-sm:flex-col max-sm:items-end">
                                {row.version > 0 ? (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={model.pending}
                                    onClick={() => model.openKeywordEdit(row)}
                                  >
                                    {t("edit")}
                                  </Button>
                                ) : null}
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={model.pending}
                                  onClick={() => {
                                    void model.toggleKeyword(row);
                                  }}
                                >
                                  {t(
                                    row.saved
                                      ? "keywords.unsave"
                                      : "keywords.save",
                                  )}
                                </Button>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        {trendOpen === row.id && trend.state === "measured" ? (
                          <TableRow id={trendId}>
                            <TableCell
                              colSpan={columns}
                              className="whitespace-normal"
                            >
                              <SeoKeywordTrendChart
                                keyword={row.keyword}
                                points={trend.points}
                              />
                            </TableCell>
                          </TableRow>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
              {hidden.length && !paidOff ? (
                <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                  {t("unmeasuredColumns", {
                    columns: format.list(hidden),
                  })}
                </p>
              ) : null}
              {shown.intent && noIntent ? (
                <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                  {t("keywords.intentMissing", { count: noIntent })}
                </p>
              ) : null}
            </div>
          ) : suggestions.length ? (
            <SeoKeywordSuggestions model={model} rows={suggestions} />
          ) : model.keywordSearch ? (
            // The search hides every row of this list; the ideas under it may still match.
            <SeoEmpty title={t("keywords.noMatch")} />
          ) : ideas.length ? null : (
            // With ideas in the Ideas list, "run a check to find keywords" would be wrong.
            <SeoEmpty
              title={t("keywords.empty")}
              // No call to run a check where no check can run.
              description={t(
                model.data.availableActions.canRequestAnalysis
                  ? "keywords.emptyBody"
                  : "keywords.emptyBodyOff",
              )}
            />
          )}
          {page.more && !model.keywordSearch ? (
            <SeoShowMore
              more={t("keywords.more", { count: page.more })}
              expanded={expanded}
              onToggle={() => setExpanded((open) => !open)}
            />
          ) : null}
        </SeoSection>
      </div>
      <div className={seoSectionClass(bothLists || section === "ideas")}>
        <SeoKeywordIdeas model={model} ideas={ideas} />
      </div>
    </div>
  );
}
