"use client";

import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type ActivityDay,
  type ActivityMode,
  activityLevel,
  activityMax,
  calendarWeeks,
  fillActivityRange,
  postingStreaks,
} from "./posting-activity";

const LEVEL_CLASS = [
  "bg-muted",
  "bg-primary/25",
  "bg-primary/45",
  "bg-primary/70",
  "bg-primary",
] as const;

export function PostingConsistency({ days }: { days: ActivityDay[] }) {
  const t = useTranslations("App.Projects.SocialPosts.statistics");
  const format = useFormatter();
  const [mode, setMode] = useState<ActivityMode>("posts");
  const filled = fillActivityRange(days);
  const streaks = postingStreaks(days);
  const weeks = calendarWeeks(days);
  const max = activityMax(filled, mode);
  const activeDays = filled.filter((day) => day.posts > 0).length;
  const totalPosts = filled.reduce((sum, day) => sum + day.posts, 0);

  function dayLabel(day: ActivityDay) {
    const date = format.dateTime(new Date(`${day.date}T12:00:00Z`), {
      dateStyle: "medium",
      timeZone: "UTC",
    });
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
      className="min-w-0 space-y-3"
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
      <p className="text-sm">
        {filled.length === 0
          ? t("performance.consistencyEmpty")
          : t("performance.consistencySummary", {
              posts: totalPosts,
              active: activeDays,
              current: streaks.current,
              longest: streaks.longest,
            })}
      </p>
      <div className="flex flex-wrap gap-6 text-sm">
        <p>
          <span className="text-muted-foreground">
            {t("performance.currentStreak")}:{" "}
          </span>
          <span className="font-medium tabular-nums">
            {t("performance.streakDays", { count: streaks.current })}
          </span>
        </p>
        <p>
          <span className="text-muted-foreground">
            {t("performance.longestStreak")}:{" "}
          </span>
          <span className="font-medium tabular-nums">
            {t("performance.streakDays", { count: streaks.longest })}
          </span>
        </p>
      </div>
      {weeks.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="flex w-max gap-1" aria-hidden="true">
            {weeks.map((week) => (
              <div
                key={week.find((day) => day)?.date ?? "pad"}
                className="flex flex-col gap-1"
              >
                {Array.from({ length: 7 }, (_, row) => {
                  const day = week[row] ?? null;
                  if (!day) {
                    return <span key={row} className="size-3" />;
                  }
                  const level = activityLevel(day, mode, max);
                  return (
                    <span
                      key={day.date}
                      title={dayLabel(day)}
                      className={cn(
                        "size-3 rounded-sm",
                        level == null
                          ? "border-border bg-background border border-dashed"
                          : LEVEL_CLASS[level],
                      )}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div className="text-muted-foreground flex items-center gap-1 text-xs">
        <span>{t("performance.legendNone")}</span>
        {LEVEL_CLASS.map((levelClass) => (
          <span
            key={levelClass}
            className={cn("size-3 rounded-sm", levelClass)}
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

export function MetricSparkline({
  values,
  label,
}: {
  values: (number | null)[];
  label: string;
}) {
  const measured = values.flatMap((value) => (value == null ? [] : [value]));
  if (measured.length === 0) return null;
  const min = Math.min(...measured);
  const max = Math.max(...measured);
  const span = max - min || 1;
  const width = 96;
  const height = 28;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  let path = "";
  values.forEach((value, index) => {
    if (value == null) return;
    const x = index * step;
    const y = height - ((value - min) / span) * height;
    path += `${path ? " L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="text-primary mt-2 h-7 w-24"
      role="img"
      aria-label={label}
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
