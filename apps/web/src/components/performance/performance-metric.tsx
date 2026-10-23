"use client";

import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { useFormatter } from "next-intl";
import { cn } from "@/lib/utils";
import { MetricSparkline } from "./metric-sparkline";

interface PerformanceMetricProps {
  label: string;
  value: string;
  title: string;
  delta?: number | null;
  deltaTitle?: string;
  sparkline?: { label: string; values: (number | null)[] };
}

export function PerformanceMetric({
  label,
  value,
  title,
  delta,
  deltaTitle,
  sparkline,
}: PerformanceMetricProps) {
  const format = useFormatter();
  return (
    <article className="flex min-w-0 flex-col">
      <p className="text-muted-foreground mb-1 text-sm">{label}</p>
      <div className="flex flex-col items-start gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
        <p
          className="text-2xl font-semibold tracking-tight whitespace-nowrap tabular-nums sm:text-4xl"
          title={title}
        >
          {value}
        </p>
        {delta != null ? (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium whitespace-nowrap tabular-nums sm:gap-1 sm:text-base",
              delta >= 0
                ? "text-semantic-success"
                : "text-semantic-destructive",
            )}
            title={deltaTitle}
          >
            {delta >= 0 ? (
              <ArrowUpRight className="size-3 sm:size-4" aria-hidden />
            ) : (
              <ArrowDownRight className="size-3 sm:size-4" aria-hidden />
            )}
            {format.number(delta, {
              signDisplay: "always",
              maximumFractionDigits: 2,
            })}
          </span>
        ) : null}
      </div>
      {sparkline ? (
        <div className="mt-auto">
          <MetricSparkline {...sparkline} />
        </div>
      ) : null}
    </article>
  );
}
