"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { MetricSparkline } from "./metric-sparkline";

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
            <article key={card.key} className="flex min-w-0 flex-col">
              <p className="text-muted-foreground mb-1 text-sm">{card.label}</p>
              <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                <p
                  className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl"
                  title={
                    card.value == null
                      ? t("unavailable")
                      : format.number(card.value)
                  }
                >
                  {number(card.value, true)}
                </p>
                {delta != null ? (
                  <span
                    className={cn(
                      "flex items-center gap-0.5 text-xs font-medium whitespace-nowrap tabular-nums sm:gap-1 sm:text-base",
                      delta >= 0
                        ? "text-semantic-success"
                        : "text-semantic-destructive",
                    )}
                    title={t("performance.previousPeriod")}
                  >
                    {delta >= 0 ? (
                      <ArrowUpRight className="size-3 sm:size-4" aria-hidden />
                    ) : (
                      <ArrowDownRight
                        className="size-3 sm:size-4"
                        aria-hidden
                      />
                    )}
                    {format.number(delta, {
                      signDisplay: "always",
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : null}
              </div>
              <MetricSparkline
                label={t("performance.sparkline", { metric: card.label })}
                values={headline.daily.map((day) =>
                  card.key === "postCount" ? day.postCount : day[card.key],
                )}
              />
            </article>
          );
        })}
      </div>
    </section>
  );
}
