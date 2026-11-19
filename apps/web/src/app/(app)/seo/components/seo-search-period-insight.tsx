import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { seoSearchPeriodInsight } from "./seo-search-period-insight-model";
import { SeoPeriod } from "./seo-shared";

export function SeoSearchPeriodInsight({
  sharing,
  metrics,
  scope,
}: {
  sharing: ProjectSeoWorkspace["sharing"];
  metrics: ProjectSeoMetric[];
  scope: ProjectSeoWorkspace["scope"];
}) {
  const t = useTranslations("App.Seo.traffic.periodInsight");
  const format = useFormatter();
  const finding = seoSearchPeriodInsight(sharing, metrics, scope);
  const pages = scope.pageIds.length;
  if (!finding || !pages) return null;
  const number = (n: number) => format.number(n, { maximumFractionDigits: 1 });
  return (
    <div className="space-y-1 border-t pt-3 text-sm">
      <h4 className="font-medium">{t("title")}</h4>
      <p className="text-muted-foreground">
        {t("scope", { count: pages, property: finding.property })}
      </p>
      <p>
        <SeoPeriod {...finding.previous} /> ·{" "}
        {t("values", {
          clicks: number(finding.beforeClicks),
          impressions: number(finding.beforeImpressions),
          position: number(finding.beforePosition),
        })}
        <br />
        <SeoPeriod {...finding.current} /> ·{" "}
        {t("values", {
          clicks: number(finding.afterClicks),
          impressions: number(finding.afterImpressions),
          position: number(finding.afterPosition),
        })}
      </p>
      <p>{t("nextCheck")}</p>
    </div>
  );
}
