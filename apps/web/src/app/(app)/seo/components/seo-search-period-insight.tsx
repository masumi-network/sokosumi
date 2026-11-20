import type {
  ProjectSeoMetric,
  ProjectSeoWorkspace,
} from "@sokosumi/core-client";
import { seoResultFormat } from "@/i18n/seo-result-messages";
import { useSeoResultTranslations } from "@/i18n/use-seo-result-translations";
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
  const t = useSeoResultTranslations("App.Seo.traffic.periodInsight");
  const finding = seoSearchPeriodInsight(sharing, metrics, scope);
  const pages = scope.pageIds.length;
  if (!finding || !pages) return null;
  const number = (n: number) =>
    seoResultFormat.number(n, { maximumFractionDigits: 1 });
  return (
    <div lang="en" className="space-y-1 border-t pt-3 text-sm">
      <h4 className="font-medium">{t("title")}</h4>
      <p className="text-muted-foreground">
        {t("scope", { count: pages, property: finding.property })}
      </p>
      {/* Two periods as a list of pairs, so a screen reader hears each period with its values. */}
      <dl className="tabular-nums">
        <div>
          <dt className="inline">
            <SeoPeriod report {...finding.previous} />
          </dt>{" "}
          <dd className="inline">
            ·{" "}
            {t("values", {
              clicks: number(finding.beforeClicks),
              impressions: number(finding.beforeImpressions),
              position: number(finding.beforePosition),
            })}
          </dd>
        </div>
        <div>
          <dt className="inline">
            <SeoPeriod report {...finding.current} />
          </dt>{" "}
          <dd className="inline">
            ·{" "}
            {t("values", {
              clicks: number(finding.afterClicks),
              impressions: number(finding.afterImpressions),
              position: number(finding.afterPosition),
            })}
          </dd>
        </div>
      </dl>
      <p>{t("nextCheck")}</p>
    </div>
  );
}
