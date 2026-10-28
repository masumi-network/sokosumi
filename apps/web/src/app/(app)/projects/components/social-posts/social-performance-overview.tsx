"use client";

import { useFormatter, useTranslations } from "next-intl";
import { PerformanceMetric } from "@/components/performance/performance-metric";
import { cn } from "@/lib/utils";

type Headline = {
  current: {
    postCount: number;
    views: number | null;
    impressions: number | null;
    interactions: number | null;
  };
  deltas: {
    postCount: number | null;
    views: number | null;
    impressions: number | null;
    interactions: number | null;
  };
  daily: Array<{
    date: string | Date;
    postCount: number;
    views: number | null;
    impressions: number | null;
    interactions: number | null;
  }>;
};

export function SocialPerformanceOverview({
  headline,
  impressionBased,
}: {
  headline: Headline;
  impressionBased: boolean;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const current = headline.current;
  const cards = [
    {
      key: "postCount" as const,
      label: t("performance.posts"),
      value: current.postCount,
    },
    {
      key: "views" as const,
      label: t("metrics.views"),
      value: current.views,
    },
    {
      key: "impressions" as const,
      label: t("metrics.impressions"),
      value: current.impressions,
    },
    {
      key: "interactions" as const,
      label: t("performance.interactions"),
      value: current.interactions,
    },
  ];
  const visibleCards = cards.filter(
    (card) =>
      (card.key !== "views" && card.key !== "impressions") ||
      card.value != null ||
      (card.key === "impressions" ? impressionBased : !impressionBased),
  );
  function number(value: number | null, compact = false) {
    return value == null
      ? "—"
      : format.number(
          value,
          compact && Math.abs(value) >= 10000
            ? { notation: "compact", maximumFractionDigits: 1 }
            : { maximumFractionDigits: 2 },
        );
  }
  return (
    <section
      aria-labelledby="key-metrics-heading"
      data-testid="social-performance-overview"
    >
      <h2 id="key-metrics-heading" className="sr-only">
        {t("performance.keyMetrics")}
      </h2>
      <div
        className={cn(
          "grid grid-cols-2 gap-x-3 gap-y-4 xl:gap-6",
          visibleCards.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-4",
        )}
      >
        {visibleCards.map((card) => {
          const delta = headline.deltas[card.key];
          return (
            <PerformanceMetric
              key={card.key}
              label={card.label}
              value={number(card.value, true)}
              title={
                card.value == null
                  ? t("unavailable")
                  : format.number(card.value)
              }
              delta={delta}
              deltaTitle={t("performance.previousPeriod")}
              sparkline={{
                label: t("performance.sparkline", { metric: card.label }),
                values: headline.daily.map((day) =>
                  card.key === "postCount" ? day.postCount : day[card.key],
                ),
              }}
            />
          );
        })}
      </div>
    </section>
  );
}
