"use client";
import type { SeoSiteTrafficReport } from "@sokosumi/core-client";
import { ArrowDown, ArrowDownUp } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { HOLDER_ITEM_CLASS } from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  SeoFoldSummary,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";
import { SeoSiteBrand } from "./seo-site-brand";
import { SeoTrendChart } from "./seo-trend-chart";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

const VISIBLE_PAGES = 5;
const metrics = ["clicks", "impressions"] as const;
export function SeoSiteTrafficReportView({
  report,
  model,
  brandLoading = false,
}: {
  report: SeoSiteTrafficReport;
  /** With the workspace, the report also shows the branded split and the brand term list. */
  model?: SeoWorkspaceModel;
  /** The report is the last read, shown while the split of a new term list loads. */
  brandLoading?: boolean;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [sort, setSort] = useState<(typeof metrics)[number]>("clicks");
  const [chartMetric, setChartMetric] = useState<
    (typeof metrics)[number] | null
  >(null);
  const activeMetric =
    chartMetric ??
    (report.daily?.some((day) => day.impressions > 0)
      ? "impressions"
      : "clicks");
  const [limit, setLimit] = useState(VISIBLE_PAGES);
  const other = sort === "clicks" ? "impressions" : "clicks";
  const pages = report.pages.toSorted(
    (a, b) =>
      b[sort] - a[sort] || b[other] - a[other] || a.url.localeCompare(b.url),
  );
  const { totals } = report;
  const mostShown = pages.reduce<(typeof pages)[number] | undefined>(
    (top, page) => (!top || page.impressions > top.impressions ? page : top),
    undefined,
  );
  const max = pages[0]?.[sort] ?? 0;
  const www = `https://www.${report.site}/`;
  const origin = pages.some((page) => page.url.startsWith(www))
    ? www
    : `https://${report.site}/`;
  return (
    <div className="space-y-5">
      <SeoSection title={t("siteTraffic.trend")}>
        <div className={cn(HOLDER_ITEM_CLASS, "space-y-4 p-4 sm:p-5")}>
          <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
            <div>
              <h3 className="font-semibold break-all">{report.site}</h3>
              <p className="text-muted-foreground text-sm">
                <SeoPeriod from={report.from} to={report.to} />
                {report.propertyId !== `sc-domain:${report.site}` && (
                  <> · {report.propertyId}</>
                )}
              </p>
            </div>
            {totals || report.daily?.length ? (
              <dl className="flex gap-6">
                {metrics.map((key) => (
                  <div
                    key={key}
                    className="relative rounded-md border px-3 py-2 has-[[aria-pressed=true]]:border-foreground"
                  >
                    <dt className="text-muted-foreground text-xs">
                      <button
                        type="button"
                        aria-pressed={activeMetric === key}
                        onClick={() => setChartMetric(key)}
                        className="after:absolute after:inset-0 after:rounded-md"
                      >
                        {t(`siteTraffic.${key}`)}
                      </button>
                    </dt>
                    <dd className="text-xl font-semibold tabular-nums">
                      {totals ? format.number(totals[key]) : t("none")}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
          {report.daily?.length ? (
            <>
              <p className="text-sm font-medium">
                {t("overview.perDay", {
                  metric: t(`siteTraffic.${activeMetric}`),
                })}
              </p>
              <SeoTrendChart
                series={{ source: "search_console", key: activeMetric }}
                label={t(`siteTraffic.${activeMetric}`)}
                points={report.daily.map((day) => ({
                  date: day.date,
                  value: day[activeMetric],
                }))}
                unit="count"
                unavailable={t("none")}
                formatValue={(v) => format.number(v)}
              />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("overview.noDailyTrend")}
            </p>
          )}
        </div>
      </SeoSection>
      {model && (
        <SeoSiteBrand
          model={model}
          report={report}
          metric={activeMetric}
          loading={brandLoading}
        />
      )}
      <SeoSection title={t("siteTraffic.pages")}>
        <div className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-4 p-4 sm:p-5")}>
          {mostShown && mostShown.impressions > 0 && mostShown.clicks === 0 && (
            <p className="border-s-2 border-chart-1 ps-3 text-sm">
              {t.rich("siteTraffic.seenWithoutClicks", {
                count: mostShown.impressions,
                page: () => (
                  <SeoPageLink
                    url={mostShown.url}
                    site={mostShown.url.startsWith(origin) ? origin : null}
                  />
                ),
              })}
            </p>
          )}
          {pages.length ? (
            <>
              <table className="w-full table-fixed text-sm">
                <caption className="sr-only">{t("siteTraffic.sort")}</caption>
                <thead className="text-muted-foreground border-b text-xs">
                  <tr>
                    <th scope="col" className="pb-2 text-start font-medium">
                      {t("page")}
                    </th>
                    {metrics.map((key) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={key === sort ? "descending" : "none"}
                        className="w-[4.75rem] text-end sm:w-28"
                      >
                        <button
                          className="hover:text-foreground focus-visible:ring-ring inline-flex min-h-10 items-center justify-end gap-1 rounded px-1 font-medium focus-visible:ring-2"
                          onClick={() => {
                            setSort(key);
                            setLimit(VISIBLE_PAGES);
                          }}
                        >
                          {t(`siteTraffic.${key}`)}
                          {key === sort ? (
                            <ArrowDown className="size-3" aria-hidden />
                          ) : (
                            <ArrowDownUp className="size-3" aria-hidden />
                          )}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {pages.slice(0, limit).map((page) => {
                    const aliases = page.submitted.filter(
                      (url) => url !== page.url,
                    );
                    const variants =
                      page.variants.length > 1 ||
                      page.variants.some((v) => v.url !== page.url)
                        ? page.variants
                        : [];
                    return (
                      <tr key={page.url}>
                        <td className="py-3 pe-2">
                          <SeoPageLink
                            url={page.url}
                            site={page.url.startsWith(origin) ? origin : null}
                          />
                          {(aliases.length > 0 || variants.length > 0) && (
                            <details className="mt-1 text-xs">
                              <SeoFoldSummary className="text-muted-foreground min-h-8">
                                {t("siteTraffic.addresses")}
                              </SeoFoldSummary>
                              <div className="space-y-2 pb-1">
                                {aliases.map((url) => (
                                  <div key={url}>
                                    {t("siteTraffic.submitted")}{" "}
                                    <SeoPageLink url={url} />
                                  </div>
                                ))}
                                {variants.map((v) => (
                                  <div key={v.url}>
                                    <SeoPageLink url={v.url} /> ·{" "}
                                    {t("siteTraffic.counts", v)}
                                  </div>
                                ))}
                              </div>
                            </details>
                          )}
                        </td>
                        {metrics.map((key) => (
                          <td
                            key={key}
                            className="px-1 text-end align-middle tabular-nums"
                          >
                            {format.number(page[key])}
                            {key === sort && max > 0 && (
                              <div
                                aria-hidden
                                className="ms-auto mt-1 h-1 w-12 overflow-hidden rounded-full bg-muted sm:w-16"
                              >
                                <div
                                  className="bg-chart-1 h-full rounded-full"
                                  style={{
                                    width: `${(100 * page[key]) / max}%`,
                                  }}
                                />
                              </div>
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pages.length > limit && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setLimit(limit + VISIBLE_PAGES)}
                >
                  {t("siteTraffic.more")}
                </Button>
              )}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {t("siteTraffic.noRows")}
            </p>
          )}
          {report.limited && (
            <p className="text-muted-foreground text-xs">
              {t("siteTraffic.limited")}
            </p>
          )}
        </div>
      </SeoSection>
    </div>
  );
}
