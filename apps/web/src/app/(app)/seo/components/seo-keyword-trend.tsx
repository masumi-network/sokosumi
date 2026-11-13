"use client";

import { ChevronDown } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { SeoKeywordTrend } from "./seo-search-model";
import { SeoTrendChart } from "./seo-trend-chart";

/**
 * Under a tracked keyword: the toggle for its daily positions, or why there are none. With a history of paid
 * checks the toggle opens both, and the reason moves under the Search Console chart's place.
 */
export function SeoKeywordTrendToggle({
  trend,
  history = false,
  open,
  controls,
  onToggle,
}: {
  trend: SeoKeywordTrend;
  /** The keyword has two or more days of paid position reads. */
  history?: boolean;
  open: boolean;
  controls: string;
  onToggle: () => void;
}) {
  const t = useTranslations("App.Seo.keywords");
  if (!history && trend.state === "absent") return null;
  if (!history && trend.state !== "measured")
    return <SeoKeywordTrendReason trend={trend} className="mt-1" />;
  return (
    <button
      type="button"
      aria-expanded={open}
      // The chart row exists only while open.
      aria-controls={open ? controls : undefined}
      onClick={onToggle}
      className="focus-visible:ring-ring mt-1 inline-flex items-center gap-1 rounded-sm py-1 text-xs underline underline-offset-4 focus-visible:ring-2 focus-visible:outline-none"
    >
      {t(history ? "historyShow" : "trendShow")}
      <ChevronDown
        className={cn("size-3 transition-transform", open && "rotate-180")}
        aria-hidden
      />
    </button>
  );
}

/** Why a tracked keyword has no daily Search Console positions. */
export function SeoKeywordTrendReason({
  trend,
  className,
}: {
  trend: SeoKeywordTrend;
  className?: string;
}) {
  const t = useTranslations("App.Seo.keywords");
  if (trend.state === "absent" || trend.state === "measured") return null;
  return (
    <p className={cn("text-muted-foreground text-xs", className)}>
      {t(trend.state === "empty" ? "trendEmpty" : "trendNotRequested")}
    </p>
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
      series={{ source: "search_console", key: "position" }}
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
