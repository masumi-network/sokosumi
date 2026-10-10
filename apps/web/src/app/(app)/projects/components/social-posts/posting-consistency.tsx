"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ActivityDay,
  type ActivityMode,
  activityLevel,
  activityMax,
  activityTotals,
  calendarMonthStarts,
  contributionCalendar,
  fillActivityRange,
  postingStreaks,
  sparklineSeries,
  sparklineSpan,
} from "./posting-activity";

const LEVEL_CLASS = [
  "bg-muted",
  "bg-primary-quinary dark:bg-primary-tertiary",
  "bg-primary-quaternary dark:bg-primary-solid",
  "bg-primary-tertiary dark:bg-primary",
  "bg-primary-solid dark:bg-chart-1",
] as const;

const WEEKDAY_ROWS = [1, 3, 5] as const;

export function PostingConsistency({
  days,
  selectedFrom,
  selectedUntil,
}: {
  days: ActivityDay[];
  selectedFrom: string | null;
  selectedUntil: string | null;
}) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [mode, setMode] = useState<ActivityMode>("posts");
  const scroller = useRef<HTMLDivElement>(null);
  const filled = fillActivityRange(days);
  const totals = activityTotals(days);
  const streaks = postingStreaks(days);
  const weeks = contributionCalendar(days);
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    node.scrollLeft = node.scrollWidth;
  }, [weeks.length]);
  const monthStarts = calendarMonthStarts(weeks);
  const max = activityMax(filled, mode);

  function formatDay(date: string) {
    return format.dateTime(new Date(`${date}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
  }

  function dayLabel(day: ActivityDay) {
    const date = formatDay(day.date);
    if (mode === "engagement" && day.engagement == null) {
      return t("performance.dayEngagementUnavailable", { date });
    }
    if (mode === "engagement") {
      return t("performance.dayEngagement", {
        date,
        count: day.engagement ?? 0,
      });
    }
    return t("performance.dayPosts", { date, count: day.posts });
  }

  return (
    <section
      className="bg-card min-w-0 space-y-4 rounded-xl border p-4 sm:p-6"
      aria-labelledby="posting-consistency"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="posting-consistency" className="text-base font-semibold">
            {t("performance.consistency")}
          </h2>
          <p className="text-muted-foreground text-sm">
            {t("performance.consistencyHint")}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            className={mode === "posts" ? undefined : "text-foreground"}
            variant={mode === "posts" ? "default" : "outline"}
            aria-pressed={mode === "posts"}
            onClick={() => setMode("posts")}
          >
            {t("performance.showPosts")}
          </Button>
          <Button
            type="button"
            size="sm"
            className={mode === "engagement" ? undefined : "text-foreground"}
            variant={mode === "engagement" ? "default" : "outline"}
            aria-pressed={mode === "engagement"}
            onClick={() => setMode("engagement")}
          >
            {t("performance.showEngagement")}
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm">
          {filled.length === 0
            ? t("performance.consistencyEmpty")
            : t("performance.consistencySummary", {
                posts: totals.posts,
                active: totals.active,
                from: formatDay(filled[0]?.date ?? ""),
                until: formatDay(filled.at(-1)?.date ?? ""),
              })}
        </p>
        {filled.length > 0 ? (
          <>
            <p className="bg-muted rounded-full px-3 py-1 text-xs">
              <span className="text-muted-foreground">
                {t("performance.currentStreak")}
              </span>{" "}
              <span className="font-medium tabular-nums">
                {t("performance.streakDays", { count: streaks.current })}
              </span>
            </p>
            <p className="bg-muted rounded-full px-3 py-1 text-xs">
              <span className="text-muted-foreground">
                {t("performance.longestStreak")}
              </span>{" "}
              <span className="font-medium tabular-nums">
                {t("performance.streakDays", { count: streaks.longest })}
              </span>
            </p>
          </>
        ) : null}
      </div>
      {weeks.length > 0 ? (
        <div className="overflow-x-auto" ref={scroller}>
          <div
            className="grid w-max gap-1"
            style={{
              gridTemplateColumns: `2rem repeat(${weeks.length}, 1rem)`,
            }}
            aria-hidden="true"
          >
            {WEEKDAY_ROWS.map((weekday) => (
              <span
                key={weekday}
                className="text-muted-foreground text-2xs self-center leading-none"
                style={{ gridColumn: 1, gridRow: weekday + 2 }}
              >
                {format.dateTime(new Date(Date.UTC(2026, 0, 4 + weekday)), {
                  weekday: "short",
                  timeZone: "UTC",
                })}
              </span>
            ))}
            {monthStarts.map((index) => {
              const cell = weeks[index]?.find((day) =>
                day.date.endsWith("-01"),
              );
              if (!cell) return null;
              return (
                <span
                  key={`month-${cell.date}`}
                  className="text-muted-foreground text-2xs min-w-0 leading-none whitespace-nowrap"
                  style={{ gridColumn: index + 2, gridRow: 1 }}
                >
                  {format.dateTime(new Date(`${cell.date}T12:00:00Z`), {
                    month: "short",
                    timeZone: "UTC",
                  })}
                </span>
              );
            })}
            {weeks.map((week, column) =>
              week.map((day, row) => {
                const measured = day.inRange
                  ? activityLevel(day, mode, max)
                  : 0;
                const selected =
                  day.inRange &&
                  selectedFrom != null &&
                  selectedUntil != null &&
                  day.date >= selectedFrom &&
                  day.date <= selectedUntil;
                return (
                  <span
                    key={day.date}
                    title={
                      day.inRange
                        ? dayLabel(day)
                        : t("performance.dayOutside", {
                            date: formatDay(day.date),
                          })
                    }
                    className={cn(
                      "aspect-square w-full rounded-xs",
                      LEVEL_CLASS[measured ?? 0],
                      selected && "ring-ring ring-1 ring-inset",
                    )}
                    style={{ gridColumn: column + 2, gridRow: row + 2 }}
                  />
                );
              }),
            )}
          </div>
        </div>
      ) : null}
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>{t("performance.legendNone")}</span>
        {LEVEL_CLASS.map((levelClass) => (
          <span
            key={levelClass}
            className={cn("size-3 rounded-xs", levelClass)}
            aria-hidden
          />
        ))}
        <span>{t("performance.legendMore")}</span>
      </div>
      <details>
        <summary className="text-muted-foreground w-fit cursor-pointer text-xs">
          {t("performance.consistencyTable")}
        </summary>
        <table className="mt-2 w-full text-sm">
          <caption className="sr-only">{t("performance.consistency")}</caption>
          <thead>
            <tr>
              <th className="text-start font-medium">
                {t("performance.date")}
              </th>
              <th className="text-end font-medium">{t("performance.posts")}</th>
              <th className="text-end font-medium">
                {t("performance.interactions")}
              </th>
            </tr>
          </thead>
          <tbody>
            {filled.map((day) => (
              <tr key={day.date}>
                <td>{day.date}</td>
                <td className="text-end tabular-nums">{day.posts}</td>
                <td className="text-end tabular-nums">
                  {day.engagement == null ? t("unavailable") : day.engagement}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  );
}

const SPARKLINE_WIDTH = 100;
const SPARKLINE_HEIGHT = 24;

export function MetricSparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const series = sparklineSpan(sparklineSeries(values));
  const measured = series.flatMap((value) => (value == null ? [] : [value]));
  const min = measured.length === 0 ? 0 : Math.min(...measured);
  const max = measured.length === 0 ? 0 : Math.max(...measured);
  const span = max - min || 1;
  const step = series.length > 1 ? SPARKLINE_WIDTH / (series.length - 1) : 0;
  const points = series.map((value, index) => {
    if (value == null) return null;
    const x = series.length === 1 ? SPARKLINE_WIDTH / 2 : index * step;
    const y =
      SPARKLINE_HEIGHT - ((value - min) / span) * (SPARKLINE_HEIGHT - 2) - 1;
    return { x, y };
  });
  const runs = pointRuns(points);
  return (
    <svg
      viewBox={`0 0 ${SPARKLINE_WIDTH} ${SPARKLINE_HEIGHT}`}
      preserveAspectRatio="none"
      className="mt-1 h-4 w-full sm:h-6"
      role="img"
      aria-label={label}
    >
      <line
        x1="0"
        x2={SPARKLINE_WIDTH}
        y1={SPARKLINE_HEIGHT - 1}
        y2={SPARKLINE_HEIGHT - 1}
        className="stroke-border"
        strokeWidth="1"
        vectorEffect="non-scaling-stroke"
      />
      {runs.map((run) => (
        <path
          key={`area-${run[0]?.x}`}
          d={areaPath(run)}
          className="fill-primary-quinary dark:fill-primary-quaternary"
        />
      ))}
      {runs.map((run) => (
        <path
          key={`line-${run[0]?.x}`}
          d={linePath(run)}
          fill="none"
          className="stroke-primary"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function pointRuns(
  points: ({ x: number; y: number } | null)[],
): { x: number; y: number }[][] {
  const runs: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    if (!point) {
      if (current.length > 0) runs.push(current);
      current = [];
      continue;
    }
    current.push(point);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

function linePath(points: { x: number; y: number }[]): string {
  const fmt = (value: number) => value.toFixed(1);
  if (points.length === 1) {
    return `M0 ${fmt(points[0]?.y ?? 0)} H${SPARKLINE_WIDTH}`;
  }
  let path = `M${fmt(points[0]?.x ?? 0)} ${fmt(points[0]?.y ?? 0)}`;
  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = points[index - 1] ?? points[index];
    const p1 = points[index];
    const p2 = points[index + 1];
    const p3 = points[index + 2] ?? p2;
    if (!p0 || !p1 || !p2 || !p3) continue;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    path += ` C${fmt(cp1x)} ${fmt(cp1y)} ${fmt(cp2x)} ${fmt(cp2y)} ${fmt(p2.x)} ${fmt(p2.y)}`;
  }
  return path;
}

function areaPath(points: { x: number; y: number }[]): string {
  if (points.length === 1) {
    const y = (points[0]?.y ?? 0).toFixed(1);
    return `M0 ${y} H${SPARKLINE_WIDTH} V${SPARKLINE_HEIGHT} H0 Z`;
  }
  const last = points.at(-1);
  const first = points[0];
  if (!last || !first) return "";
  return `${linePath(points)} L${last.x.toFixed(1)} ${SPARKLINE_HEIGHT} L${first.x.toFixed(1)} ${SPARKLINE_HEIGHT} Z`;
}
