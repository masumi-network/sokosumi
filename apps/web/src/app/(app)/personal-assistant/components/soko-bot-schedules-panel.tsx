import { getFormatter, getTranslations } from "next-intl/server";

import { Panel } from "@/components/soko-bot/panel";
import type { SokoBotSchedule } from "@/lib/clients/generated/core";

import { ScheduleForm } from "./schedule-form.client";
import { ScheduleRowActions } from "./schedule-row-actions.client";

interface SokoBotSchedulesPanelProps {
  schedules: SokoBotSchedule[];
}

/** User-owned prompt schedules: list with enable/delete + a create form. */
export async function SokoBotSchedulesPanel({
  schedules,
}: SokoBotSchedulesPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.SokoBot.Schedules"),
    getFormatter(),
  ]);

  return (
    <Panel
      id="soko-bot-schedules"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: schedules.length })}
        </span>
      }
      flush
    >
      {schedules.length > 0 ? (
        <ul className="divide-y border-b">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="space-y-1.5 px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {schedule.name}
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">
                    {schedule.cronExpression} · {schedule.timezone}
                  </p>
                </div>
                <ScheduleRowActions
                  scheduleId={schedule.id}
                  enabled={schedule.enabled}
                />
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs">
                {schedule.prompt}
              </p>
              <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-0.5 text-xs">
                <div className="flex gap-1">
                  <dt>{t("nextRun")}</dt>
                  <dd className="text-foreground tabular-nums">
                    {schedule.enabled
                      ? format.dateTime(schedule.nextRunAt, {
                          dateStyle: "short",
                          timeStyle: "short",
                        })
                      : t("disabled")}
                  </dd>
                </div>
                {schedule.lastRunAt ? (
                  <div className="flex gap-1">
                    <dt>{t("lastRun")}</dt>
                    <dd className="text-foreground tabular-nums">
                      {format.dateTime(schedule.lastRunAt, {
                        dateStyle: "short",
                        timeStyle: "short",
                      })}
                    </dd>
                  </div>
                ) : null}
                {schedule.consecutiveFailures > 0 ? (
                  <div className="flex gap-1">
                    <dt>{t("failures")}</dt>
                    <dd className="text-semantic-destructive tabular-nums">
                      {schedule.consecutiveFailures}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground border-b px-4 py-3 text-xs">
          {t("empty")}
        </p>
      )}
      <div className="px-4 py-3">
        <ScheduleForm />
      </div>
    </Panel>
  );
}
