"use client";

import { Check, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { seoPageSummaries } from "./seo-overview-model";
import { topPages } from "./seo-search-model";
import {
  SEO_STACKED_TABLE_CLASS,
  SeoDate,
  SeoEmpty,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
  SeoState,
} from "./seo-shared";
import {
  latestSeoMeasurements,
  seoQueryPeriod,
  seoReportedPeriod,
} from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** Saved selections and page rankings only help when there are pages to compare. */
const MIN_PAGES_FOR_SELECTIONS = 2;

function SeoTopPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const source = model.data.searchQueries;
  const rows = source ? topPages(source.rows) : [];
  // One page's totals are on the Performance card; its listed-query sums would only disagree with them.
  if (!source || rows.length < MIN_PAGES_FOR_SELECTIONS) return null;
  const rate = (value: number | null, percent = false) =>
    value === null
      ? t("none")
      : format.number(value, {
          maximumFractionDigits: 1,
          ...(percent ? { style: "percent" } : {}),
        });
  return (
    <div className="xl:col-span-2">
      <SeoSection
        title={t("pages.topPages")}
        description={
          <>
            {t("pages.topPagesHelp")} ·{" "}
            <SeoPeriod {...seoQueryPeriod(source, model.data.metrics)} />
            {source.truncated
              ? ` · ${t("queries.truncated", { count: source.rowLimit })}`
              : null}
          </>
        }
      >
        <div className={HOLDER_ITEM_CLASS}>
          <Table className={SEO_STACKED_TABLE_CLASS}>
            <TableHeader>
              <TableRow>
                <TableHead>{t("page")}</TableHead>
                <TableHead className="text-right">
                  {t("queries.clicks")}
                </TableHead>
                <TableHead className="text-right">
                  {t("queries.impressions")}
                </TableHead>
                <TableHead className="text-right">{t("queries.ctr")}</TableHead>
                <TableHead className="text-right">
                  {t("queries.position")}
                </TableHead>
                <TableHead className="text-right">
                  {t("pages.queryCount")}
                </TableHead>
                <TableHead>{t("pages.topQuery")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.pageUrl}>
                  <TableCell className="min-w-48 whitespace-normal">
                    <SeoPageLink url={row.pageUrl} />
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("queries.clicks")}
                  >
                    {format.number(row.clicks)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("queries.impressions")}
                  >
                    {format.number(row.impressions)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("queries.ctr")}
                  >
                    {rate(row.ctr, true)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("queries.position")}
                  >
                    {rate(row.averagePosition)}
                  </TableCell>
                  <TableCell
                    className="text-right tabular-nums"
                    data-label={t("pages.queryCount")}
                  >
                    {format.number(row.queries)}
                  </TableCell>
                  <TableCell
                    className="min-w-40 whitespace-normal break-words"
                    data-label={t("pages.topQuery")}
                  >
                    <bdi>{row.topQuery}</bdi>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </SeoSection>
    </div>
  );
}

/** Search totals that belong to one page: only when the saved statistics cover that page alone. */
// The same order as the Performance tiles.
const PAGE_TOTALS = ["clicks", "impressions", "ctr", "position"] as const;

export function SeoPages({ model }: { model: SeoWorkspaceModel }) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const summaries = seoPageSummaries(model.data);
  const scopePages = model.data.scope.pageIds;
  const search = latestSeoMeasurements(model.data.metrics).filter(
    (metric) => metric.source === "search_console",
  );
  const choosable = model.data.pages.length >= MIN_PAGES_FOR_SELECTIONS;
  const datesFiltered = Boolean(model.data.scope.from || model.data.scope.to);
  const totalsPeriod = search[0]
    ? // The same rule as the query rows: only the end moves to the last reported day.
      {
        from: search[0].from,
        to: seoReportedPeriod(search)?.to ?? search[0].to,
      }
    : null;
  return (
    <div className={cn("grid gap-6", choosable && "xl:grid-cols-2")}>
      <SeoTopPages model={model} />
      <SeoSection
        title={t("pages.title")}
        actions={
          model.data.availableActions.canEdit ? (
            <Button size="sm" onClick={() => model.setDialog("page")}>
              <Plus className="size-4" />
              {t("addPage")}
            </Button>
          ) : null
        }
      >
        {model.data.pages.length ? (
          <ul className="space-y-2">
            {model.data.pages.map((page) => {
              const parent = model.data.pages.find(
                (candidate) => candidate.id === page.relatedToPageId,
              );
              const summary = summaries.get(page.id);
              const totals =
                scopePages.length === 1 && scopePages[0] === page.id
                  ? PAGE_TOTALS.flatMap((key) => {
                      const metric = search.find((item) => item.key === key);
                      // An unavailable read is not a measurement, as on the Performance card.
                      return metric &&
                        metric.value !== null &&
                        metric.coverage !== "unavailable"
                        ? [{ key, value: metric.value }]
                        : [];
                    })
                  : [];
              return (
                <li
                  key={page.id}
                  className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      {page.label && page.label !== page.url ? (
                        <h3 className="text-sm font-medium break-words">
                          {page.label}
                        </h3>
                      ) : null}
                      <SeoPageLink url={page.url} />
                    </div>
                    {/* A lone page is the primary page; the badge would say nothing. */}
                    {model.data.pages.length > 1 ||
                    page.relationship !== "primary" ? (
                      <SeoState>{t(page.relationship)}</SeoState>
                    ) : null}
                  </div>
                  {page.relatedToPageId ? (
                    <p className="text-muted-foreground text-sm">
                      {t("relatedTo")}:{" "}
                      {parent?.label || parent?.url || t("page")}
                    </p>
                  ) : null}
                  {totals.length || summary ? (
                    // Two columns on a phone, like the query and keyword cards.
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:flex sm:flex-wrap sm:gap-x-5">
                      {totals.map(({ key, value }) => (
                        <div key={key}>
                          <dt className="text-muted-foreground text-xs">
                            {t(`metrics.${key}`)}
                          </dt>
                          <dd className="font-medium tabular-nums">
                            {key === "ctr"
                              ? format.number(value, {
                                  style: "percent",
                                  maximumFractionDigits: 1,
                                })
                              : format.number(value, {
                                  minimumFractionDigits:
                                    key === "position" ? 1 : 0,
                                  maximumFractionDigits:
                                    key === "position" ? 1 : 0,
                                })}
                          </dd>
                        </div>
                      ))}
                      {summary ? (
                        <div className="col-span-2">
                          <dt className="text-muted-foreground text-xs">
                            {t("pages.lastCheck")}
                          </dt>
                          <dd className="font-medium">
                            {summary.checkedAt ? (
                              <>
                                <SeoDate value={summary.checkedAt} /> ·{" "}
                                {/* Known issues stay visible; an incomplete check adds its note. */}
                                {summary.incomplete && !summary.issues
                                  ? t("pages.checkIncomplete")
                                  : t("pages.issues", {
                                      count: summary.issues,
                                    })}
                                {summary.incomplete && summary.issues
                                  ? ` · ${t("pages.checkIncomplete")}`
                                  : null}
                              </>
                            ) : (
                              // Checks outside the date filter are not in view.
                              t(
                                datesFiltered
                                  ? "pages.notCheckedInDates"
                                  : "pages.notChecked",
                              )
                            )}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                  ) : null}
                  {totals.length && totalsPeriod ? (
                    <p className="text-muted-foreground text-xs">
                      {t("statistics.search_console")} ·{" "}
                      <SeoPeriod {...totalsPeriod} />
                    </p>
                  ) : null}
                  {choosable ? (
                    <Button
                      size="sm"
                      variant="outline"
                      aria-pressed={model.filters.pageId === page.id}
                      onClick={() => {
                        void model.setFilters({
                          pageId: page.id,
                          scopeId: null,
                        });
                      }}
                    >
                      {model.filters.pageId === page.id ? (
                        <Check className="size-4" />
                      ) : null}
                      {t("pages.choose")}
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <SeoEmpty title={t("noPages")} description={t("noPagesBody")} />
        )}
      </SeoSection>
      {model.data.pages.length < MIN_PAGES_FOR_SELECTIONS ? null : (
        <SeoSection
          title={t("pages.groups")}
          actions={
            model.data.availableActions.canEdit && model.data.pages.length ? (
              <Button size="sm" onClick={() => model.setDialog("scope")}>
                <Plus className="size-4" />
                {t("createScope")}
              </Button>
            ) : null
          }
        >
          {model.data.scopes.length ? (
            <ul className="space-y-2">
              {model.data.scopes.map((scope) => (
                <li
                  className={`${HOLDER_ITEM_CLASS} space-y-3 p-4`}
                  key={scope.id}
                >
                  <div>
                    <h3 className="text-sm font-medium">{scope.name}</h3>
                    <p className="text-muted-foreground text-sm">
                      {t("pages.count", { count: scope.pageIds.length })} ·{" "}
                      {t("pages.version", { version: scope.version })}
                    </p>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {scope.pageIds.map((id) => {
                      const page = model.data.pages.find(
                        (candidate) => candidate.id === id,
                      );
                      return page ? (
                        <li key={id}>
                          <SeoPageLink url={page.url} label={page.label} />
                        </li>
                      ) : null;
                    })}
                  </ul>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      void model.setFilters({
                        scopeId: scope.id,
                        pageId: null,
                      });
                    }}
                  >
                    {model.filters.scopeId === scope.id ? (
                      <Check className="size-4" />
                    ) : null}
                    {t("pages.chooseSelection")}
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <SeoEmpty description={t("pages.emptyGroups")} />
          )}
        </SeoSection>
      )}
    </div>
  );
}
