"use client";

import { useFormatter, useTranslations } from "next-intl";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SeoBreakdown } from "./seo-breakdown";
import { SeoQueryFilter } from "./seo-keywords";
import { SeoMeasurements } from "./seo-measurements";
import { MIN_PAGES_FOR_SELECTIONS } from "./seo-pages";
import { topPages } from "./seo-search-model";
import { SeoSearchQueries } from "./seo-search-queries";
import {
  SEO_STACKED_TABLE_CLASS,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";
import { seoQueryPeriod } from "./seo-statistics-model";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** What Google measured for the selected pages: totals and trend, the searches behind them, and each page's share. */
export function SeoTraffic({ model }: { model: SeoWorkspaceModel }) {
  return (
    <div className="space-y-6">
      <SeoMeasurements model={model} />
      <SeoQueryFilter
        model={model}
        rows={model.data.searchQueries?.rows.length ?? 0}
      />
      <SeoSearchQueries model={model} />
      <SeoTopPages model={model} />
      <SeoBreakdown model={model} />
    </div>
  );
}

export function SeoTopPages({ model }: { model: SeoWorkspaceModel }) {
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
  );
}
