"use client";
import type { SeoSiteTrafficReport } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { SeoField, SeoSelect } from "./seo-form-fields";
import {
  SeoFoldSummary,
  SeoPageLink,
  SeoPeriod,
  SeoSection,
} from "./seo-shared";

const VISIBLE_PAGES = 25;
export function SeoSiteTrafficReportView({
  report,
}: {
  report: SeoSiteTrafficReport;
}) {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  const [sort, setSort] = useState<"clicks" | "impressions">("clicks");
  const [limit, setLimit] = useState(VISIBLE_PAGES);
  const pages = report.pages.toSorted(
    (a, b) => b[sort] - a[sort] || a.url.localeCompare(b.url),
  );
  return (
    <SeoSection title={report.site}>
      <p className="text-muted-foreground text-sm">
        <SeoPeriod from={report.from} to={report.to} /> · {report.propertyId}
      </p>
      <dl className="my-4 grid grid-cols-2 gap-4">
        {(["clicks", "impressions"] as const).map((key) => (
          <div key={key}>
            <dt className="text-muted-foreground text-sm">
              {t(`metrics.${key}`)}
            </dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {report.totals
                ? format.number(report.totals[key])
                : t("coverageStatus.unavailable")}
            </dd>
          </div>
        ))}
      </dl>
      {pages.length ? (
        <>
          <SeoField label={t("siteTraffic.sort")} id="seo-page-order">
            <SeoSelect
              id="seo-page-order"
              value={sort}
              onValueChange={(v) =>
                setSort(v === "clicks" ? "clicks" : "impressions")
              }
              options={(["clicks", "impressions"] as const).map((key) => ({
                value: key,
                label: t(`metrics.${key}`),
              }))}
            />
          </SeoField>
          <ul className="mt-3 divide-y">
            {pages.slice(0, limit).map((page) => (
              <li key={page.url}>
                <details>
                  <SeoFoldSummary>
                    <span className="min-w-0 break-all">{page.url}</span>
                    <span className="ms-auto shrink-0 text-end tabular-nums">
                      {t("siteTraffic.counts", {
                        clicks: page.clicks,
                        impressions: page.impressions,
                      })}
                    </span>
                  </SeoFoldSummary>
                  <div className="space-y-2 px-2 pb-3 text-sm">
                    {page.submitted.map((url) => (
                      <p key={url}>
                        {t("siteTraffic.submitted")} <SeoPageLink url={url} />
                      </p>
                    ))}
                    {page.variants.length ? (
                      page.variants.map((v) => (
                        <p key={v.url}>
                          <SeoPageLink url={v.url} /> ·{" "}
                          {t("siteTraffic.counts", {
                            clicks: v.clicks,
                            impressions: v.impressions,
                          })}
                        </p>
                      ))
                    ) : (
                      <p>{t("siteTraffic.noRows")}</p>
                    )}
                  </div>
                </details>
              </li>
            ))}
          </ul>
          {pages.length > limit && (
            <Button
              variant="outline"
              onClick={() => setLimit(limit + VISIBLE_PAGES)}
            >
              {t("siteTraffic.more")}
            </Button>
          )}
        </>
      ) : (
        <p>{t("siteTraffic.noRows")}</p>
      )}
      {report.limited && (
        <p className="text-muted-foreground text-sm">
          {t("siteTraffic.limited")}
        </p>
      )}
    </SeoSection>
  );
}
