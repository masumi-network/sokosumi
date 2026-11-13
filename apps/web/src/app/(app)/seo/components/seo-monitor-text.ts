import type { ProjectSeoMonitor } from "@sokosumi/core-client";
import { useFormatter, useTranslations } from "next-intl";
import { formatWeekday } from "@/lib/schedules/cron";
import { seoMonitorPlan } from "./seo-monitor-model";

type SeoTranslate = ReturnType<typeof useTranslations<"App.Seo">>;
type Formatter = ReturnType<typeof useFormatter>;

export interface SeoMonitorPlanInput {
  rule: { expr: string; timezone: string; targetRunCount?: number | null };
  kind: ProjectSeoMonitor["kind"];
  pageCount: number;
}

/**
 * The translated plan sentence of a monitor: its check, its pages, when it runs and when it ends. Server pages pass
 * their own translator and formatter; client views use the hook below.
 */
export function seoMonitorPlanText(
  t: SeoTranslate,
  format: Formatter,
  monitor: SeoMonitorPlanInput,
): string {
  const plan = seoMonitorPlan(monitor.rule);
  const time = (hour: number, minute: number) =>
    format.dateTime(new Date(Date.UTC(2026, 0, 1, hour, minute)), "time", {
      timeZone: "UTC",
    });
  const when =
    plan.repeat === "daily"
      ? t("monitor.plan.daily", { time: time(plan.hour, plan.minute) })
      : plan.repeat === "weekly"
        ? t("monitor.plan.weekly", {
            days: format.list(
              plan.weekdays.map((day) => formatWeekday(day, format)),
            ),
            time: time(plan.hour, plan.minute),
          })
        : plan.repeat === "monthly"
          ? t("monitor.plan.monthly", {
              day: plan.dayOfMonth,
              time: time(plan.hour, plan.minute),
            })
          : t("monitor.plan.other");
  const sentence = t("monitor.plan.sentence", {
    check: t(`analysis.${monitor.kind}`),
    pages: monitor.pageCount,
    when,
    zone: monitor.rule.timezone,
  });
  const ends =
    monitor.rule.targetRunCount == null
      ? t("monitor.plan.untilStopped")
      : t("monitor.plan.endsAfter", { count: monitor.rule.targetRunCount });
  return `${sentence} ${ends}`;
}

export function useSeoMonitorPlanText() {
  const t = useTranslations("App.Seo");
  const format = useFormatter();
  return (monitor: Pick<ProjectSeoMonitor, "rule" | "kind" | "pageIds">) =>
    seoMonitorPlanText(t, format, {
      ...monitor,
      pageCount: monitor.pageIds.length,
    });
}
