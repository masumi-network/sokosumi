"use client";

import { useFormatter, useLocale, useTranslations } from "next-intl";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
import { seoDaySpan } from "./seo-day-span";
import { SeoConversionCell, SeoConversionNote } from "./seo-keyword-conversion";
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
import { seoOpenFixes, seoOverviewModel } from "./seo-overview-model";
import { SeoRankPill } from "./seo-rank-pill";
import { SeoRowMenu } from "./seo-row-menu";
import { seoRunsNameSpan } from "./seo-runs-model";
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
  SeoAddButton,
  SeoBarNumber,
  SeoDate,
  SeoEmpty,
  SeoMetaLine,
  SeoNextStepRow,
  SeoPageText,
  SeoPeriod,
  type SeoRankingsSection,
  SeoSection,
  SeoShowMore,
  SeoSource,
  seoMarketName,
  seoSectionClass,
} from "./seo-shared";
import { seoQueryPeriod } from "./seo-statistics-model";
import { SeoKeywordDemand, SeoStrategyFold } from "./seo-strategy";
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
  const dayOf = (value: string | Date | null) =>
    value ? format.dateTime(new Date(value), { dateStyle: "medium" }) : "";
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
    // Only a check that estimates conversion fills the column.
    conversion: checked.some((group) => group.conversion !== null),
    // Where no keyword shows a page, the result line says so once; a column of "Not found" adds nothing.
    position: !(
      all.checked.length > 0 &&
      all.checked.every(
        (group) => group.reads.length > 0 && group.best === null,
      )
    ),
    // One market for every keyword is said once, in the result line above the table.
    market: markets.size > 1 || !summary.read,
    // The same priority on every keyword tells nothing; the edit dialog still sets it.
    // All keywords decide, so a search does not hide the column.
    priority: new Set(model.data.keywords.map((row) => row.priority)).size > 1,
  };
  // Without the Position column no row has a place for the day of its check, so the line under the result
  // names the days of the oldest and of the newest check. A date under each name stood on most rows.
  const checkDays =
    !shown.position &&
    summary.oldest?.observedAt &&
    summary.newest?.observedAt &&
    dayOf(summary.oldest.observedAt) !== dayOf(summary.newest.observedAt)
      ? seoDaySpan(format, summary.oldest.observedAt, summary.newest.observedAt)
      : null;
  const strategy = model.data.strategy;
  // The results the date of a check opens.
  const taskOf = (observationId: string | null) =>
    model.data.observations.find((item) => item.id === observationId)
      ?.sourceTaskId ?? null;
  // Where the runs row over the tabs names the days of the checks, the line names the results alone. Without
  // results to open, the words would be no link: the line keeps its dates.
  const namedDays = taskOf(summary.newest?.observationId ?? null)
    ? seoRunsNameSpan(
        model.data,
        model.filters,
        summary.oldest?.observedAt ?? summary.newest?.observedAt,
        summary.newest?.observedAt,
      )
    : 0;
  const hidden = [shown.volume ? null : t("keywords.volume")].filter(
    (label): label is string => label !== null,
  );
  // Without paid search data these columns can never fill, so nothing names them.
  const paidOff = model.data.availableActions.canUsePaidSearchData !== true;
  const manyPages = model.data.scope.pageIds.length > 1;
  // One keyword's daily positions open at a time, in a full-width row under it.
  const [trendOpen, setTrendOpen] = useState<string | null>(null);
  const columns =
    2 +
    Number(shown.position) +
    Number(shown.market) +
    Number(shown.volume) +
    Number(shown.conversion) +
    Number(shown.priority);
  const first = model.data.keywords[0];
  // The bars set each keyword against the most searched one of the list.
  const mostSearched = Math.max(
    0,
    ...checked.map((group) => group.volume ?? 0),
  );
  const groupOf = seoStrategyGroupOf(model.data.strategy);
  // A keyword in two rows of one Market has two pages: each of these rows names its page, the primary page too.
  // The Market column tells the rows of two Markets apart.
  const nameOf = (row: (typeof checked)[number]["lead"]) =>
    JSON.stringify([
      normalizeQuery(row.keyword),
      row.countryCode,
      row.languageCode,
    ]);
  const names = checked.map((group) => nameOf(group.lead));
  const repeated = new Set(
    names.filter((name, index) => names.indexOf(name) !== index),
  );
  // A check that found no page in the results is the worst result of the tab. The fixes the agent proposes are
  // the one next step it can offer, so the card leads to them.
  const fixes =
    summary.read > 0 && summary.found === 0
      ? seoOpenFixes(seoOverviewModel(model.data)).length
      : 0;
  // One search box filters keywords and ideas: while it holds text, both lists show their matches.
  const bothLists = Boolean(model.keywordSearch) && section !== "competitors";
  return (
    <div className="space-y-5">
      <div className={seoSectionClass(bothLists || section === "keywords")}>
        <SeoSection
          // The switch above names the list, so the title is its result: one sentence.
          title={
            summary.read
              ? t("keywords.summary", {
                  found: summary.found,
                  read: summary.read,
                })
              : t("keywords.title")
          }
          strong={summary.read > 0}
          actions={
            model.data.availableActions.canEdit ? (
              <SeoAddButton
                label={t("keywords.addButton")}
                lead={!rows.length}
                onClick={() => model.setDialog("keyword")}
              />
            ) : null
          }
        >
          {summary.read ? (
            // Under the result: the market and the date the rows no longer repeat. The date opens the check's results.
            <SeoMetaLine
              className="px-2 pb-1 text-sm"
              items={[
                [
                  "firstPage",
                  summary.found
                    ? t("keywords.firstPage", { count: summary.firstPage })
                    : null,
                ],
                [
                  "market",
                  !shown.market && first
                    ? seoMarketName(
                        locale,
                        first.countryCode,
                        first.languageCode,
                      )
                    : null,
                ],
                [
                  "check",
                  summary.newest ? (
                    <SeoSource
                      workspace={model.data}
                      observationId={summary.newest.observationId}
                    >
                      {namedDays ? (
                        // The runs row over the tabs names these days.
                        t("keywords.checks", { count: namedDays })
                      ) : checkDays ? (
                        t("competitors.checkedBetween", checkDays)
                      ) : (
                        <>
                          {t("keywords.readOn")}{" "}
                          <SeoDate day value={summary.newest.observedAt} />
                        </>
                      )}
                    </SeoSource>
                  ) : null,
                ],
                [
                  "depth",
                  summary.depth
                    ? t("summary.depth", {
                        ...summary.depth,
                        same:
                          summary.depth.min === summary.depth.max
                            ? "yes"
                            : "no",
                      })
                    : null,
                ],
              ]}
            />
          ) : null}
          {fixes ? (
            <SeoNextStepRow
              onClick={() => {
                void model.setFilters({ tab: "actions" });
              }}
            >
              {t("keywords.nextFixes", { count: fixes })}
            </SeoNextStepRow>
          ) : null}
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
                    {shown.conversion ? (
                      <TableHead>{t("keywords.conversion.title")}</TableHead>
                    ) : null}
                    {shown.position ? (
                      <TableHead>{t("keywords.position")}</TableHead>
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
                  {rows.map((group) => {
                    const { lead: row, reads, volume, sources } = group;
                    // The result line dates the newest check. A row of an older check carries its own day
                    // under its position, unless it is the same day: the line already says that day.
                    const lastRead = reads.at(0);
                    const olderDay =
                      lastRead?.observedAt &&
                      lastRead.observationId !==
                        summary.newest?.observationId &&
                      dayOf(lastRead.observedAt) !==
                        dayOf(summary.newest?.observedAt ?? null)
                        ? lastRead.observedAt
                        : null;
                    const target = model.data.pages.find(
                      (page) => page.id === row.targetPageId,
                    );
                    // Only an unmeasured position falls back to the Search Console period average.
                    const average = reads.length
                      ? undefined
                      : averages?.get(normalizeQuery(row.keyword));
                    // Daily positions are read for tracked keywords only.
                    const read = row.saved
                      ? keywordTrend(queries, row.keyword, row.countryCode)
                      : ({ state: "absent" } as const);
                    // A keyword tracked from its check, with no choice of the reader, shows its daily positions and
                    // no line about a sync: "not read in the last sync" or "no impressions" on every row of a
                    // check would be noise.
                    const trend =
                      read.state !== "measured" && row.version === 0
                        ? ({ state: "absent" } as const)
                        : read;
                    const trendId = `seo-keyword-trend-${row.id}`;
                    // Without a rank or a listed average, the position cell says "no impressions"; the line under the keyword would repeat it.
                    const cellSaysEmpty =
                      read.state === "empty" &&
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
                                // The page as text: a link under every keyword made the list a second list of links.
                                <SeoPageText
                                  url={row.pageUrl}
                                  workspace={model.data}
                                  skipPrimary={!repeated.has(nameOf(row))}
                                  oneLine
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
                              // No number, no unit: the label names the empty value.
                              data-label={
                                volume === null
                                  ? t("keywords.volume")
                                  : undefined
                              }
                            >
                              {volume === null ? (
                                <span className="text-muted-foreground">
                                  {t("none")}
                                </span>
                              ) : (
                                <SeoBarNumber
                                  value={volume}
                                  max={mostSearched}
                                  unit={t("keywords.volumeUnit", {
                                    count: volume,
                                  })}
                                />
                              )}
                            </TableCell>
                          ) : null}
                          {shown.conversion ? (
                            <SeoConversionCell
                              conversion={group.conversion}
                              feature={group.feature}
                            />
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
                                      {line.position !== null ? (
                                        <SeoRankPill position={line.position} />
                                      ) : (
                                        t("keywords.notFound")
                                      )}
                                    </p>
                                  ))}
                                  {olderDay ? (
                                    <p className="text-muted-foreground text-xs">
                                      {t("observed")}:{" "}
                                      <SeoDate day value={olderDay} />
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
                          {shown.priority ? (
                            <TableCell data-label={t("keywords.priority")}>
                              {t(`priority.${row.priority}`)}
                            </TableCell>
                          ) : null}
                          <TableCell>
                            {model.data.availableActions.canEdit ? (
                              <div className="flex justify-end">
                                {row.saved ? (
                                  // A tracked keyword asks for nothing. One quiet menu holds its rare actions:
                                  // a button on every row was a question the reader did not have.
                                  <SeoRowMenu
                                    label={t("keywords.rowActions", {
                                      keyword: row.keyword,
                                    })}
                                  >
                                    <DropdownMenuItem
                                      disabled={model.pending}
                                      onSelect={() =>
                                        model.openKeywordEdit(row)
                                      }
                                    >
                                      {t("edit")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      disabled={model.pending}
                                      onSelect={() => {
                                        void model.toggleKeyword(row);
                                      }}
                                    >
                                      {t("keywords.unsave")}
                                    </DropdownMenuItem>
                                  </SeoRowMenu>
                                ) : (
                                  // The reader stopped tracking it: the way back is the one action of the row.
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    disabled={model.pending}
                                    onClick={() => {
                                      void model.toggleKeyword(row);
                                    }}
                                  >
                                    {t("keywords.save")}
                                  </Button>
                                )}
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
              {shown.conversion ? <SeoConversionNote /> : null}
              {hidden.length && !paidOff ? (
                <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                  {t("unmeasuredColumns", {
                    columns: format.list(hidden),
                  })}
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
          <SeoStrategyFold
            model={model}
            // The date line of the list names the same check, or opens the same results: a second date line
            // would repeat it. Another check of the same day keeps its line: it is the only link to its results.
            dated={Boolean(
              strategy &&
                summary.newest &&
                (strategy.observationId === summary.newest.observationId ||
                  (taskOf(strategy.observationId) !== null &&
                    taskOf(strategy.observationId) ===
                      taskOf(summary.newest.observationId))),
            )}
          />
        </SeoSection>
      </div>
      <div className={seoSectionClass(bothLists || section === "ideas")}>
        <SeoKeywordIdeas model={model} ideas={ideas} />
      </div>
    </div>
  );
}
