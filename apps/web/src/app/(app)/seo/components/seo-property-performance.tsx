"use client";

import type { ProjectSeoWorkspace } from "@sokosumi/core-client";
import {
  useSeoResultFormatter,
  useSeoResultTranslations,
} from "@/i18n/use-seo-result-translations";

type Evidence = NonNullable<ProjectSeoWorkspace["auditSearchConsole"]>[number];
export const auditMetrics = [
  ["clicks", "clicks"],
  ["impressions", "impressions"],
  ["ctr", "ctr"],
  ["averagePosition", "average_position"],
] as const;

export function useAuditMetricFormat() {
  const report = useSeoResultTranslations("App.Seo");
  const format = useSeoResultFormatter();
  const period = (value: Pick<Evidence, "from" | "to">) =>
    report("reportFiles.period", {
      from: new Date(value.from).toISOString().slice(0, 10),
      to: new Date(value.to).toISOString().slice(0, 10),
    });
  const number = (value: number | null, key: string) =>
    value === null
      ? report("coverageStatus.unavailable")
      : format.number(
          value,
          key === "ctr"
            ? { style: "percent", maximumFractionDigits: 1 }
            : { maximumFractionDigits: 1 },
        );
  return { period, number };
}

export function SeoPropertyPerformance({ evidence }: { evidence: Evidence }) {
  const report = useSeoResultTranslations("App.Seo");
  const { period, number } = useAuditMetricFormat();
  const { propertyTotals } = evidence;
  if (!propertyTotals) return null;
  return (
    <section lang="en" className="space-y-2">
      <h4 className="font-medium">
        {report("reportFiles.propertyPerformance")}
      </h4>
      <p className="text-muted-foreground">{period(evidence)}</p>
      <dl className="grid grid-cols-2 gap-3">
        {auditMetrics.map(([key, label]) => (
          <div key={key}>
            <dt className="text-muted-foreground">
              {report(`metrics.${label}`)}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">
              {number(propertyTotals[key], key)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
