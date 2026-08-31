import { getFormatter, getTranslations } from "next-intl/server";

import { Panel } from "@/components/soko-bot/panel";
import { ScheduleRunStatusBadge } from "@/components/soko-bot/soko-bot-badges";
import { StatusBadge } from "@/components/soko-bot/status-badge";
import type { AdminSokoBotSchedule } from "@/lib/clients/generated/core";

import { AdminScheduleAction } from "./admin-schedule-action.client";

interface AdminSchedulesPanelProps {
  sokoBotId: string;
  schedules: AdminSokoBotSchedule[];
}

export async function AdminSchedulesPanel({
  sokoBotId,
  schedules,
}: AdminSchedulesPanelProps) {
  const [t, format] = await Promise.all([
    getTranslations("App.Admin.SokoBots.Schedules"),
    getFormatter(),
  ]);
  const dateTime = (date: Date | null) =>
    date
      ? format.dateTime(date, { dateStyle: "short", timeStyle: "short" })
      : "—";

  return (
    <Panel
      id="schedules"
      title={t("title")}
      description={t("description")}
      aside={
        <span className="text-muted-foreground text-xs tabular-nums">
          {t("count", { count: schedules.length })}
        </span>
      }
      flush
    >
      {schedules.length === 0 ? (
        <p className="text-muted-foreground px-4 py-6 text-sm">{t("empty")}</p>
      ) : (
        <ul className="divide-y">
          {schedules.map((schedule) => (
            <li key={schedule.id} className="space-y-3 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{schedule.name}</span>
                <StatusBadge tone={schedule.enabled ? "success" : "neutral"}>
                  {schedule.enabled ? t("enabled") : t("disabled")}
                </StatusBadge>
                <span className="text-muted-foreground font-mono text-xs">
                  {schedule.cronExpression} · {schedule.timezone}
                </span>
                <span className="text-muted-foreground text-xs">
                  {t("nextRun")} {dateTime(schedule.nextRunAt)} · {t("lastRun")}{" "}
                  {dateTime(schedule.lastRunAt)}
                </span>
                {schedule.consecutiveFailures > 0 ? (
                  <span className="text-semantic-destructive text-xs">
                    {t("failures", { count: schedule.consecutiveFailures })}
                  </span>
                ) : null}
                <AdminScheduleAction
                  sokoBotId={sokoBotId}
                  targetId={schedule.id}
                  action="DISABLE_SCHEDULE"
                  disabled={!schedule.enabled}
                />
              </div>
              <p className="text-muted-foreground line-clamp-2 text-xs">
                {schedule.prompt}
              </p>
              {schedule.runs.length > 0 ? (
                <div className="overflow-x-auto rounded border">
                  <table className="w-full text-xs">
                    <thead className="text-muted-foreground border-b text-left">
                      <tr>
                        <th className="px-3 py-1.5 font-medium">
                          {t("scheduledFor")}
                        </th>
                        <th className="px-3 py-1.5 font-medium">
                          {t("status")}
                        </th>
                        <th className="px-3 py-1.5 font-medium">
                          {t("attempt")}
                        </th>
                        <th className="px-3 py-1.5 font-medium">{t("turn")}</th>
                        <th className="px-3 py-1.5 font-medium">
                          {t("completedAt")}
                        </th>
                        <th className="px-3 py-1.5 font-medium">
                          {t("error")}
                        </th>
                        <th className="px-3 py-1.5 font-medium">
                          {t("actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {schedule.runs.map((run) => (
                        <tr key={run.id}>
                          <td className="px-3 py-1.5 tabular-nums">
                            {dateTime(run.scheduledFor)}
                          </td>
                          <td className="px-3 py-1.5">
                            <ScheduleRunStatusBadge status={run.status} />
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {run.attempt}
                          </td>
                          <td className="text-muted-foreground px-3 py-1.5 font-mono">
                            {run.turnId ? run.turnId.slice(0, 8) : "—"}
                          </td>
                          <td className="px-3 py-1.5 tabular-nums">
                            {dateTime(run.completedAt)}
                          </td>
                          <td className="text-semantic-destructive px-3 py-1.5">
                            {run.errorKind
                              ? `${run.errorKind}${run.errorDetail ? `: ${run.errorDetail}` : ""}`
                              : ""}
                          </td>
                          <td className="px-3 py-1.5">
                            {run.status === "FAILED" ||
                            run.status === "DEAD_LETTER" ? (
                              <AdminScheduleAction
                                sokoBotId={sokoBotId}
                                targetId={run.id}
                                action="RETRY_SCHEDULE_RUN"
                              />
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-muted-foreground text-xs">{t("noRuns")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
