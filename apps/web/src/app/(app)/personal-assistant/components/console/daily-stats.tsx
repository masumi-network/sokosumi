"use client";

import { useFormatter, useTranslations } from "next-intl";

import type { SokoBotDailyStats } from "@/lib/clients/generated/core";
import { cn } from "@/lib/utils";

const WIDTH = 640;
const HEIGHT = 120;
const GAP = 3;

/**
 * Stacked bars per day: messages from the owner, then work the bot started
 * on its own. Totals for the window sit above the chart.
 */
export function DailyStats({ stats }: { stats: SokoBotDailyStats }) {
  const t = useTranslations("App.SokoBot.Console.Stats");
  const format = useFormatter();
  const max = Math.max(
    1,
    ...stats.daily.map((day) => day.messages + day.background),
  );
  const barWidth =
    (WIDTH - GAP * (stats.daily.length - 1)) / stats.daily.length;
  const scale = (value: number) => (value / max) * (HEIGHT - 4);
  const totals = [
    { key: "messages", value: stats.totals.messages },
    { key: "background", value: stats.totals.background },
    { key: "tasks", value: stats.totals.tasks },
    { key: "jobs", value: stats.totals.jobs },
    { key: "toolCalls", value: stats.totals.toolCalls },
  ] as const;
  const quiet = stats.totals.messages + stats.totals.background === 0;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {totals.map((total, index) => (
          <div
            key={total.key}
            className={cn(
              "min-w-0 rounded-lg px-3 py-2.5",
              index === 0
                ? "bg-primary/10 text-primary"
                : "bg-muted/50 text-foreground",
            )}
          >
            <dt
              className={cn(
                "truncate text-xs",
                index === 0 ? "text-primary/80" : "text-muted-foreground",
              )}
            >
              {t(total.key)}
            </dt>
            <dd className="text-2xl font-light tabular-nums">{total.value}</dd>
          </div>
        ))}
      </dl>
      {quiet ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <div className="space-y-2">
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-28 w-full"
            role="img"
            aria-label={t("chartLabel", { days: stats.days })}
          >
            {stats.daily.map((day, index) => {
              const x = index * (barWidth + GAP);
              const messages = scale(day.messages);
              const background = scale(day.background);
              return (
                <g key={day.date}>
                  <title>
                    {`${format.dateTime(new Date(day.date), { month: "short", day: "numeric" })}: ${day.messages} ${t("messages")}, ${day.background} ${t("background")}`}
                  </title>
                  <rect
                    x={x}
                    y={HEIGHT - 1}
                    width={barWidth}
                    height={1}
                    className="fill-border"
                  />
                  <rect
                    x={x}
                    y={HEIGHT - messages - background}
                    width={barWidth}
                    height={background}
                    rx={1}
                    className="fill-primary/35"
                  />
                  <rect
                    x={x}
                    y={HEIGHT - messages}
                    width={barWidth}
                    height={messages}
                    rx={1}
                    className="fill-primary"
                  />
                </g>
              );
            })}
          </svg>
          <div className="text-muted-foreground flex items-center justify-between text-xs">
            <span>
              {format.dateTime(new Date(stats.daily[0]?.date ?? Date.now()), {
                month: "short",
                day: "numeric",
              })}
            </span>
            <span className="flex items-center gap-3">
              <Legend className="bg-primary" label={t("messages")} />
              <Legend className="bg-primary/35" label={t("background")} />
            </span>
            <span>{t("today")}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block size-2 rounded-sm", className)} />
      {label}
    </span>
  );
}
