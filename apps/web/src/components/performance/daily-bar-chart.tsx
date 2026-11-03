"use client";

import { useFormatter } from "next-intl";
import { cn } from "@/lib/utils";

interface DailyBarChartProps {
  label: string;
  points: { date: string; value: number | null }[];
  unavailable: string;
}

export function DailyBarChart({
  label,
  points,
  unavailable,
}: DailyBarChartProps) {
  const format = useFormatter();
  const peak = Math.max(0, ...points.map((point) => point.value ?? 0));
  const minimum = Math.min(0, ...points.map((point) => point.value ?? 0));
  const span = peak - minimum || 1;
  function dateLabel(date: string) {
    return format.dateTime(new Date(`${date}T12:00:00Z`), {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  }
  function valueLabel(value: number | null) {
    return value == null ? unavailable : format.number(value);
  }
  return (
    <figure className="min-w-0 space-y-3" aria-label={label}>
      <div
        className="relative flex h-40 items-end border-b"
        style={{ columnGap: `min(1px, ${25 / Math.max(1, points.length)}%)` }}
        aria-hidden="true"
      >
        {minimum < 0 ? (
          <div
            className="border-border absolute inset-x-0 border-t"
            style={{ bottom: `${(-minimum / span) * 100}%` }}
          />
        ) : null}
        {points.map((point) => (
          <div
            key={point.date}
            className="relative flex h-full min-w-0 flex-1 items-end"
            title={`${dateLabel(point.date)}: ${valueLabel(point.value)}`}
          >
            <div
              className={cn(
                "w-full rounded-t-sm",
                point.value == null
                  ? "border-border h-2 border border-dashed"
                  : point.value === 0
                    ? "bg-border h-px"
                    : "bg-chart-1",
              )}
              style={
                minimum < 0
                  ? {
                      position: "absolute",
                      bottom: `${(((point.value ?? 0) >= 0 ? -minimum : (point.value ?? 0) - minimum) / span) * 100}%`,
                      height: `${Math.max(1, (Math.abs(point.value ?? 0) / span) * 100)}%`,
                    }
                  : point.value == null || point.value === 0
                    ? undefined
                    : {
                        height: `${Math.max(2, peak ? (point.value / peak) * 100 : 0)}%`,
                      }
              }
            />
          </div>
        ))}
      </div>
      <div className="text-muted-foreground flex justify-between gap-3 text-xs">
        <span>{points[0] ? dateLabel(points[0].date) : unavailable}</span>
        <span>{points.at(-1) ? dateLabel(points.at(-1)?.date ?? "") : ""}</span>
      </div>
      <div className="sr-only">
        {points.map((point) => (
          <p key={point.date}>
            {dateLabel(point.date)}: {valueLabel(point.value)}
          </p>
        ))}
      </div>
    </figure>
  );
}
