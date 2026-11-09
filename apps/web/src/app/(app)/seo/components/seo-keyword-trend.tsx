"use client";

import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SeoKeywordTrend } from "./seo-search-model";
import { SeoTrendChart } from "./seo-trend-chart";

/** Under a tracked keyword: the toggle for its daily positions, or why there are none yet. */
export function SeoKeywordTrendToggle({
  trend,
  open,
  controls,
  onToggle,
}: {
  trend: SeoKeywordTrend;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const t = useTranslations("App.Seo.keywords");
  if (trend.state === "absent") return null;
  if (trend.state !== "measured")
    return (
      <p className="text-muted-foreground mt-1 text-xs">
        {t(trend.state === "empty" ? "trendEmpty" : "trendNotRequested")}
      </p>
    );
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="focus-visible:ring-ring mt-1 inline-flex items-center gap-1 rounded-sm py-1 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
    >
      {t("trendShow")}
      <ChevronDown
        className={cn("size-3 transition-transform", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}

/** A keyword's daily average position; lower is better, so the axis runs top-down. */
export function SeoKeywordTrendChart({
  keyword,
  points,
}: {
  keyword: string;
  points: Extract<SeoKeywordTrend, { state: "measured" }>["points"];
}) {
  const t = useTranslations("App.Seo.keywords");
  const format = useFormatter();
  return (
    <SeoTrendChart
      points={points}
      unit="position"
      label={t("trendLabel", { keyword })}
      formatValue={(value) =>
        format.number(value, {
          minimumFractionDigits: 1,
          maximumFractionDigits: 1,
        })
      }
      unavailable={t("trendNoImpressions")}
    />
  );
}
