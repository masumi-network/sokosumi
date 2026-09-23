import { CalendarSync } from "lucide-react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { taskSchedulePath } from "@/app/tasks/utils/task-schedule-view";
import { taskScheduleService } from "@/lib/services/task-schedule.service";

/**
 * "From schedule …" on a Task a Run created. A schedule the viewer may not
 * open (private to someone else) is mentioned without a link or a name.
 */
export async function TaskFromSchedule({
  scheduleId,
}: {
  scheduleId: string | null;
}) {
  if (!scheduleId) return null;

  const [schedule, t] = await Promise.all([
    taskScheduleService.getSchedule(scheduleId),
    getTranslations("App.Tasks.Detail"),
  ]);

  return (
    <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
      <CalendarSync className="size-4 shrink-0" aria-hidden />
      {schedule ? (
        <Link
          href={taskSchedulePath(schedule.id)}
          className="text-primary hover:underline"
        >
          {t("fromSchedule", { name: schedule.name })}
        </Link>
      ) : (
        t("fromHiddenSchedule")
      )}
    </p>
  );
}
