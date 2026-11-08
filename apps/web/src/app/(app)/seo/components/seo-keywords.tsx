"use client";

import { Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
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
import { normalizeQuery, searchConsoleIndex } from "./seo-search-model";
import { SeoSearchQueries } from "./seo-search-queries";
import {
  SEO_SEARCH_MIN_ROWS,
  SEO_STACKED_TABLE_CLASS,
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
  SeoSource,
  SeoState,
} from "./seo-shared";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

export function SeoKeywords({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const rows = model.filteredKeywords;
  const queries = model.data.searchQueries;
  const averages = queries ? searchConsoleIndex(queries.rows) : null;
  // A column no row has measured only repeats "Not available"; name it once instead.
  const shown = {
    volume: rows.some((row) => row.volume !== null),
    intent: rows.some((row) => row.intent !== null),
    observed: rows.some((row) => row.observedAt !== null),
    source: rows.some((row) => row.observationId || row.source !== "saved"),
  };
  const hidden = [
    shown.volume ? null : t("keywords.volume"),
    shown.intent ? null : t("keywords.intent"),
    shown.observed ? null : t("observed"),
  ].filter((label): label is string => label !== null);
  // Without paid search data these columns stay empty; say why once, not "yet".
  const paidOff = model.data.availableActions.canUsePaidSearchData !== true;
  const manyPages = model.data.scope.pageIds.length > 1;
  return (
    <div className="space-y-5">
      {model.data.keywords.length +
        (model.data.searchQueries?.rows.length ?? 0) >=
        SEO_SEARCH_MIN_ROWS || model.keywordSearch ? (
        <div>
          <Label className="sr-only" htmlFor="seo-keyword-search">
            {t("search")}
          </Label>
          <Input
            id="seo-keyword-search"
            type="search"
            value={model.keywordSearch}
            onChange={(event) => model.setKeywordSearch(event.target.value)}
            placeholder={t("keywords.searchPlaceholder")}
          />
        </div>
      ) : null}
      <SeoSearchQueries model={model} />
      <SeoSection
        title={t("keywords.title")}
        description={t("keywords.help")}
        actions={
          model.data.availableActions.canEdit ? (
            <Button size="sm" onClick={() => model.setDialog("keyword")}>
              <Plus className="size-4" />
              {t("keywords.add")}
            </Button>
          ) : null
        }
      >
        {rows.length ? (
          <div className={HOLDER_ITEM_CLASS}>
            <Table className={SEO_STACKED_TABLE_CLASS}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("keywords.keyword")}</TableHead>
                  <TableHead>{t("keywords.market")}</TableHead>
                  {shown.volume ? (
                    <TableHead className="text-right">
                      {t("keywords.volume")}
                    </TableHead>
                  ) : null}
                  <TableHead className="text-right">
                    {t("keywords.position")}
                  </TableHead>
                  {shown.intent ? (
                    <TableHead>{t("keywords.intent")}</TableHead>
                  ) : null}
                  <TableHead>{t("keywords.priority")}</TableHead>
                  {shown.observed ? (
                    <TableHead>{t("observed")}</TableHead>
                  ) : null}
                  {shown.source ? <TableHead>{t("source")}</TableHead> : null}
                  <TableHead>
                    <span className="sr-only">{t("queries.rowActions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const target = model.data.pages.find(
                    (page) => page.id === row.targetPageId,
                  );
                  // Only an unmeasured position falls back to the Search Console period average.
                  const average =
                    row.positionStatus === "unavailable"
                      ? averages?.get(normalizeQuery(row.keyword))
                      : undefined;
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-48 whitespace-normal">
                        <p className="font-medium break-words">
                          <bdi>{row.keyword}</bdi>
                        </p>
                        {/* In a one-page scope the page link only repeats; "any page" still says something. */}
                        {row.pageUrl ? (
                          manyPages ? (
                            <SeoPageLink url={row.pageUrl} />
                          ) : null
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            {t("keywords.anyPage")}
                          </span>
                        )}
                        {row.version > 0 ? (
                          <p className="text-muted-foreground mt-1 text-xs">
                            {t("keywords.target")}:{" "}
                            {target?.label ||
                              target?.url ||
                              t("keywords.anyPage")}
                          </p>
                        ) : null}
                        <div className="mt-1">
                          <SeoState>
                            {t(
                              row.saved
                                ? "keywords.saved"
                                : "keywords.discovered",
                            )}
                          </SeoState>
                        </div>
                      </TableCell>
                      <TableCell data-label={t("keywords.market")}>
                        {row.countryCode} / {row.languageCode}
                        {row.device ? (
                          <div className="text-muted-foreground text-sm">
                            {t(`analysis.${row.device}`)}
                          </div>
                        ) : null}
                      </TableCell>
                      {shown.volume ? (
                        <TableCell
                          className="text-right tabular-nums"
                          data-label={t("keywords.volume")}
                        >
                          {row.volume === null
                            ? t("none")
                            : format.number(row.volume)}
                        </TableCell>
                      ) : null}
                      <TableCell
                        className="text-right whitespace-normal tabular-nums"
                        data-label={t("keywords.position")}
                      >
                        {row.positionStatus === "ranked" &&
                        row.position !== null ? (
                          format.number(row.position)
                        ) : row.positionStatus === "not_in_range" ? (
                          row.checkedResults === null ? (
                            t("keywords.notInRangeUnknown")
                          ) : (
                            t("keywords.notInRange", {
                              count: row.checkedResults,
                            })
                          )
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
                              <SeoPeriod from={queries.from} to={queries.to} />
                              {queries.truncated
                                ? ` · ${t("queries.truncated", { count: queries.rowLimit })}`
                                : null}
                            </p>
                          </>
                        ) : queries ? (
                          // Absent from the listed rows is not zero: Google hides rare searches.
                          <>
                            <p>
                              {queries.truncated
                                ? t("keywords.notInKeptRows", {
                                    count: queries.rowLimit,
                                  })
                                : t("keywords.notListed")}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              <SeoPeriod from={queries.from} to={queries.to} />
                            </p>
                          </>
                        ) : (
                          t("keywords.unavailable")
                        )}
                      </TableCell>
                      {shown.intent ? (
                        <TableCell data-label={t("keywords.intent")}>
                          {row.intent ?? t("none")}
                        </TableCell>
                      ) : null}
                      <TableCell data-label={t("keywords.priority")}>
                        {t(`priority.${row.priority}`)}
                      </TableCell>
                      {shown.observed ? (
                        <TableCell data-label={t("observed")}>
                          <SeoDate value={row.observedAt} />
                        </TableCell>
                      ) : null}
                      {shown.source ? (
                        <TableCell data-label={t("source")}>
                          <span className="text-muted-foreground text-sm">
                            {row.source}
                          </span>
                          {row.observationId ? (
                            <div>
                              <SeoSource
                                workspace={model.data}
                                observationId={row.observationId}
                              />
                            </div>
                          ) : null}
                        </TableCell>
                      ) : null}
                      <TableCell>
                        {model.data.availableActions.canEdit ? (
                          <div className="flex flex-wrap justify-end gap-2">
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
                                row.saved ? "keywords.unsave" : "keywords.save",
                              )}
                            </Button>
                          </div>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            {hidden.length ? (
              <p className="text-muted-foreground border-t px-4 py-2 text-xs">
                {t(paidOff ? "paidDataOff" : "unmeasuredColumns", {
                  columns: format.list(hidden),
                })}
              </p>
            ) : null}
          </div>
        ) : (
          <SeoEmpty
            title={t("keywords.empty")}
            description={t("keywords.emptyBody")}
          />
        )}
      </SeoSection>
    </div>
  );
}
