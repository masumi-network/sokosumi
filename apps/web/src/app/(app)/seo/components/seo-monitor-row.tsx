"use client";

import type { ProjectSeoMonitor } from "@sokosumi/core-client";
import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { TaskScheduleWhen } from "@/app/tasks/components/task-schedule-when";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { SEO_MAX_MONITOR_RUNS } from "./seo-form-model";
import { SeoMonitorChange } from "./seo-monitor-change";
import { seoMonitorPagesDiffer, seoMonitorRunsLeft } from "./seo-monitor-model";
import { useSeoMonitorPlanText } from "./seo-monitor-text";
import { SeoDate, SeoState } from "./seo-shared";
import { useSeoMonitor } from "./use-seo-monitor";
import type { SeoWorkspaceModel } from "./use-seo-workspace";

/** One monitor: its plan, its last result, what changed, and the commands the reader may give it. */
export function SeoMonitorRow({
  model,
  monitor,
}: {
  model: SeoWorkspaceModel;
  monitor: ProjectSeoMonitor;
}) {
  const t = useTranslations("App.Seo.monitor");
  const scheduleT = useTranslations("App.Tasks.Schedules");
  const planText = useSeoMonitorPlanText();
  const row = useSeoMonitor(model, monitor);
  const canEdit = model.data.availableActions.canEdit;
  const ended = monitor.state === "ENDED";
  const runsLeft = seoMonitorRunsLeft(monitor);
  const pagesDiffer =
    !ended && seoMonitorPagesDiffer(monitor, model.data.scope.pageIds);
  return (
    <li
      className="space-y-2 py-3 first:pt-0 last:pb-0"
      data-testid="seo-monitor"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 max-w-prose text-sm">{planText(monitor)}</p>
        <SeoState>
          {scheduleT.has(`state.${monitor.state}`)
            ? scheduleT(`state.${monitor.state}`)
            : monitor.state}
        </SeoState>
      </div>
      <dl className="text-muted-foreground grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
        {ended ? null : (
          <>
            <dt>{t("next")}</dt>
            <dd>
              {monitor.state === "PAUSED" ? (
                t("pausedNext")
              ) : (
                <SeoDate
                  value={monitor.nextRunAt}
                  timeZone={monitor.rule.timezone}
                />
              )}
            </dd>
          </>
        )}
        <dt>{t("last")}</dt>
        <dd>
          {monitor.lastRun ? (
            <>
              {t(`lastStatus.${monitor.lastRun.status}`)},{" "}
              <SeoDate
                value={monitor.lastRun.at}
                timeZone={monitor.rule.timezone}
              />
            </>
          ) : (
            t("noRunYet")
          )}
        </dd>
        <dt>{t("left")}</dt>
        <dd>
          {runsLeft !== null ? (
            t("leftCount", { count: runsLeft })
          ) : monitor.rule.endsOn ? (
            <>
              {t("leftUntil")}{" "}
              <SeoDate
                value={monitor.rule.endsOn}
                timeZone={monitor.rule.timezone}
              />
            </>
          ) : (
            t("leftUntilStopped")
          )}
        </dd>
      </dl>
      <SeoMonitorChange change={monitor.change} />
      {pagesDiffer ? (
        <p className="flex items-start gap-1.5 text-xs">
          <TriangleAlert
            aria-hidden
            className="text-status-warning mt-0.5 size-3.5 shrink-0"
          />
          {t("pagesDiffer", { count: monitor.pageIds.length })}
        </p>
      ) : null}
      {row.editing && row.when && !ended ? (
        <div className="bg-muted space-y-3 rounded-lg p-3">
          <TaskScheduleWhen
            value={row.when}
            onChange={row.setWhen}
            storedCron={monitor.rule.expr}
            maxRunCount={SEO_MAX_MONITOR_RUNS}
          />
          {row.tooOften ? (
            <p role="alert" className="text-destructive text-xs">
              {t("onceADay")}
            </p>
          ) : null}
          {row.belowReleased ? (
            <p role="alert" className="text-destructive text-xs">
              {t("belowReleased", { count: monitor.releasedCount })}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={!row.canSave || row.pending}
              onClick={() => void row.save()}
            >
              {t("saveRule")}
            </Button>
            <Button size="sm" variant="ghost" onClick={row.cancelEdit}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {canEdit && !ended ? (
            <>
              {monitor.isOwner ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={row.pending}
                  onClick={() => void row.runNow()}
                >
                  {t("runNow")}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={row.pending}
                onClick={() =>
                  void row.changeState(
                    monitor.state === "PAUSED" ? "resume" : "pause",
                  )
                }
              >
                {t(monitor.state === "PAUSED" ? "resume" : "pause")}
              </Button>
              {monitor.isOwner ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={row.pending}
                  onClick={row.startEdit}
                >
                  {t("edit")}
                </Button>
              ) : null}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="ghost" disabled={row.pending}>
                    {t("end")}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{t("endTitle")}</AlertDialogTitle>
                    <AlertDialogDescription>
                      {t("endBody")}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t("cancel")}</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void row.changeState("end")}
                    >
                      {t("endConfirm")}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </>
          ) : null}
          <Link
            href={`/schedules/${encodeURIComponent(monitor.id)}`}
            className="text-muted-foreground hover:text-foreground py-1 text-xs underline underline-offset-4"
          >
            {t("manage")}
          </Link>
        </div>
      )}
    </li>
  );
}
