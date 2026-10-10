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
        <h2 id="posting-consistency" className="text-base font-semibold">
          {t("performance.consistency")}
        </h2>
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
    </section>
  );
}
