import { CalendarSync } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";

import {
  formatTaskScheduleRule,
  taskSchedulePath,
} from "@/app/tasks/utils/task-schedule-view";
import { taskScheduleService } from "@/lib/services/task-schedule.service";
import { stripMarkdownToText } from "@/lib/utils/strip-markdown";

/**
 * Schedule value in a Task's properties: the schedule it came from, its rule
 * and next run (or state). A schedule the viewer may not open (private to
 * someone else) is mentioned without a link, name or rule.
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
    <div className="min-w-0 text-right">
      <Link
        href={taskSchedulePath(schedule.id)}
        className="hover:text-primary inline-flex max-w-full items-center gap-1.5 text-sm font-medium transition-colors"
      >
        <CalendarSync
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <span className="truncate">
          {stripMarkdownToText(schedule.name) || schedule.name}
        </span>
      </Link>
      <p className="text-muted-foreground text-xs">
        {rule} · {status}
      </p>
    </div>
  );
}
