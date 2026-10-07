import { useFormatter, useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

interface HistorySpendChartProps {
  days: Array<{ date: string; credits: number }>;
}

/**
 * Credits spent per day as thin bars. One colour, no axes: the bar height is
 * the only encoding, and the exact figure is in each bar's tooltip and in the
 * chart's accessible label. Server-rendered, no chart library.
 */
export function HistorySpendChart({ days }: HistorySpendChartProps) {
  const t = useTranslations("App.TransactionHistory.Chart");
  const format = useFormatter();
  const total = days.reduce((sum, day) => sum + day.credits, 0);
  const peak = Math.max(...days.map((day) => day.credits), 0);

  if (total === 0) return null;

  return (
    <figure className="flex flex-col gap-3" aria-label={t("label")}>
      <figcaption className="text-muted-foreground text-sm">
        {t("total", { count: format.number(Math.round(total * 100) / 100) })}
      </figcaption>
      <ul className="flex h-16 items-end gap-1">
        {days.map((day) => (
          <li
            key={day.date}
            className="flex h-full min-w-0 flex-1 items-end"
            title={t("day", {
              date: format.dateTime(new Date(`${day.date}T00:00:00Z`), {
                dateStyle: "medium",
                timeZone: "UTC",
              }),
              count: format.number(Math.round(day.credits * 100) / 100),
            })}
          >
            <div
              className={cn(
                "w-full rounded-sm",
                day.credits === 0 ? "bg-border h-px" : "bg-primary",
              )}
              style={
                day.credits === 0
                  ? undefined
                  : { height: `${Math.max((day.credits / peak) * 100, 4)}%` }
              }
            />
          </li>
        ))}
      </ul>
    </figure>
  );
}
