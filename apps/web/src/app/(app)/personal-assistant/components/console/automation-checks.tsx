"use client";

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import type { SokoBotDailyStats } from "@/lib/clients/generated/core";

/**
 * Whether the automation ran, not just what it decided. A bot that stayed
 * quiet and a bot whose crons stopped look identical from the activity list;
 * this is the only place that tells them apart.
 */
export function AutomationChecks({
  checks,
}: {
  checks: SokoBotDailyStats["checks"];
}) {
  const t = useTranslations("App.SokoBot.Console.Automation");
  const format = useFormatter();
  const late = checks.items.filter((item) => item.late);

  function when(value: string | null): string {
    return value ? format.relativeTime(new Date(value)) : t("never");
  }

  return (
    <div className="space-y-3">
      {late.length > 0 ? (
        <p className="text-destructive flex items-start gap-2 text-sm">
          <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>{t("lateWarning", { count: late.length })}</span>
        </p>
      ) : (
        <p className="text-muted-foreground flex items-start gap-2 text-sm">
          <CheckCircle2 aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            {t("lastSelfStarted", { when: when(checks.lastSelfStartedAt) })}
          </span>
        </p>
      )}
      {checks.items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-border divide-y text-sm">
          {checks.items.map((item) => (
            <li
              key={`${item.key}:${item.name}`}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2"
            >
              <span className="font-medium">{item.name}</span>
              <span className="text-muted-foreground flex flex-wrap gap-x-3 text-xs tabular-nums">
                <span>{t("ran", { when: when(item.lastRunAt) })}</span>
                {item.nextRunAt ? (
                  <span className={item.late ? "text-destructive" : undefined}>
                    {item.late
                      ? t("overdue", { when: when(item.nextRunAt) })
                      : t("due", { when: when(item.nextRunAt) })}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
