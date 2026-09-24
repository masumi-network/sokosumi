import { CalendarSync } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  formatTaskScheduleRule,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import { stripInlineMarkdown } from "@/lib/utils/strip-markdown";

/**
 * Schedule value in a Task's properties: the schedule it came from, with its
 * rule and next run (or state) on hover. A schedule the viewer may not open
 * (private to someone else) is mentioned without a link, name or rule.
 */
export async function TaskFromSchedule({ scheduleId }: { scheduleId: string }) {
  const [schedule, t, tSchedules, tSchedule, formatter] = await Promise.all([
    taskScheduleService.getSchedule(scheduleId),
    getTranslations("App.Tasks.Detail"),
    getTranslations("App.Tasks.Schedules"),
    getTranslations("App.Tasks.Schedule"),
    getFormatter(),
  ]);

  if (!schedule) {
    return (
      <span className="text-right text-sm font-medium">
        {t("privateSchedule")}
      </span>
    );
  }

  const rule = formatTaskScheduleRule(schedule.rule, formatter, tSchedule);
  const status =
    schedule.state === "ACTIVE"
      ? schedule.nextRunAt
        ? tSchedules("nextRun", {
            datetime: formatter.dateTime(schedule.nextRunAt, "dateTimeMedium"),
          })
        : tSchedules("noNextRun")
      : tSchedules(`state.${schedule.state}`);

  return (
    <Link
      href={taskSchedulePath(schedule.id)}
      title={`${rule} · ${status}`}
      className="hover:text-primary flex min-w-0 items-center gap-1.5 text-sm font-medium transition-colors"
    >
      <CalendarSync
        className="text-muted-foreground size-4 shrink-0"
        aria-hidden
      />
      <span className="truncate">{stripInlineMarkdown(schedule.name)}</span>
    </Link>
  );
}
