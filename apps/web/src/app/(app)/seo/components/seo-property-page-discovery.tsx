"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";
import { SeoFoldSummary, SeoPageLink } from "./seo-shared";

type Report = NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number];

export function SeoPropertyPageDiscovery({
  report,
  actionsOnly = false,
}: {
  report: Report;
  actionsOnly?: boolean;
}) {
  const t = useSeoResultTranslations("App.Seo.pageDiscovery");
  const discovery = report.pageDiscovery;
  if (!discovery) return null;
  const pages = actionsOnly
    ? discovery.pages.filter((page) => page.suggestion)
    : discovery.pages;
  if (actionsOnly && !pages.length) return null;
  return (
    <section lang="en" className="min-w-0 space-y-2">
      <h4 className="font-semibold">{t(actionsOnly ? "reviews" : "title")}</h4>
      {discovery.comparisonIncomplete && (
        <p className="text-sm text-muted-foreground">{t("partial")}</p>
      )}
      {!pages.length && !discovery.comparisonIncomplete && (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      )}
      {pages.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {pages.map((page) => (
            <li key={page.pageUrl} className="p-3">
              <details>
                <SeoFoldSummary className="min-h-10 gap-2">
                  <span className="min-w-0">
                    <span className="block break-words font-medium">
                      {page.suggestion ?? t(page.reason)}
                    </span>
                    <span
                      className="block break-all text-xs text-muted-foreground"
                      dir="auto"
                    >
                      {page.pageUrl}
                    </span>
                  </span>
                </SeoFoldSummary>
                <SeoPropertyPageFacts report={report} page={page} />
              </details>
            </li>
          ))}
        </ul>
      )}
      {discovery.limited && (
        <p className="text-xs text-muted-foreground">{t("limited")}</p>
      )}
    </section>
  );
}

export interface SeoPropertyPageFactsProps {
  report: Report;
  page: NonNullable<Report["pageDiscovery"]>["pages"][number];
}
export function SeoPropertyPageFacts({
  report,
  page,
}: SeoPropertyPageFactsProps) {
  const discovery = report.pageDiscovery;
  const t = useSeoResultTranslations("App.Seo.pageDiscovery");
  const format = useSeoResultFormatter();
  if (!discovery) return null;
  const period = (value: { from: Date | string; to: Date | string }) =>
    t("range", {
      from: new Date(value.from).toISOString().slice(0, 10),
      to: new Date(value.to).toISOString().slice(0, 10),
    });
  return (
    <>
      {page.expectedEffect && <p className="mt-2">{page.expectedEffect}</p>}
      <dl className="mt-3 space-y-2">
        {(
          [
            ["audit", report, page.totals],
            ["recent", discovery.recent, page.recent],
            ["previous", discovery.previous, page.previous],
          ] as const
        ).map(([key, window, counts]) => (
          <div key={key}>
            <dt className="text-muted-foreground">
              {t(key)} · {period(window)}
            </dt>
            <dd>{t("counts", counts)}</dd>
          </div>
        ))}
        {page.query && (
          <div>
            <dt className="text-muted-foreground">{t("query")}</dt>
            <dd className="break-words" dir="auto">
              {page.query.query}
            </dd>
            <dd>
              {t("counts", page.query)} ·{" "}
              {t("position", {
                value: format.number(page.query.averagePosition, {
                  maximumFractionDigits: 1,
                }),
              })}
            </dd>
          </div>
        )}
      </dl>
      <p className="my-2 text-muted-foreground">
        {page.suggestion
          ? t(page.reason)
          : t(page.queryUnavailable ? "queryUnavailable" : "observe")}
      </p>
      <SeoPageLink url={page.pageUrl} label={t("openPage")} />
    </>
  );
}
