"use client";

import type { NewsletterAnalyticsTotals } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { PerformanceMetric } from "@/components/performance/performance-metric";

export function NewsletterMetrics({
  totals,
  compact = false,
}: {
  totals: NewsletterAnalyticsTotals;
  compact?: boolean;
}) {
  const t = useTranslations("App.Projects.Newsletter.Analytics");
  const format = useFormatter();
  const metrics = compact
    ? ([
        "sent",
        "delivered",
        "uniqueOpens",
        "uniqueClicks",
        "openRate",
        "clickRate",
      ] as const)
    : ([
        "sent",
        "delivered",
        "uniqueOpens",
        "uniqueClicks",
        "openRate",
        "clickRate",
        "activeSubscribers",
        "unsubscribes",
        "bounces",
        "complaints",
      ] as const);
  function value(key: (typeof metrics)[number], full = false) {
    if (totals[key] == null) return t("unavailable");
    return key === "openRate" || key === "clickRate"
      ? format.number(totals[key], {
          style: "percent",
          maximumFractionDigits: 1,
        })
      : format.number(
          totals[key],
          !full && (totals[key] ?? 0) >= 10000
            ? { notation: "compact", maximumFractionDigits: 1 }
            : {},
        );
  }
  return (
    <section
      aria-label={t("keyMetrics")}
      className="grid grid-cols-2 gap-x-3 gap-y-4 md:grid-cols-3 xl:grid-cols-4 xl:gap-6"
    >
      {metrics.map((key) => (
        <PerformanceMetric
          key={key}
          label={t(`metrics.${key}`)}
          value={value(key)}
          title={value(key, true)}
        />
      ))}
    </section>
  );
}

export function NewsletterAnalyticsNotes() {
  const t = useTranslations("App.Projects.Newsletter.Analytics");
  return (
    <div className="text-muted-foreground space-y-1 text-sm" role="note">
      <p>{t("ratesNote")}</p>
      <p>{t("opensNote")}</p>
    </div>
  );
}
