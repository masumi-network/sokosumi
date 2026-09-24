import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import {
  changeTaskScheduleRun,
  type TaskScheduleActionError,
} from "@/lib/actions/task-schedule/action";
import type { WorkspaceCalendarItem } from "@/lib/clients/generated/core";

type RunChange =
  | { action: "skip" | "restore" }
  | { action: "move"; scheduledAt: Date };

/** A Task Schedule Run the viewer may skip, move, or restore. */
export type ChangeableRun = WorkspaceCalendarItem & {
  scheduleId: string;
  scheduleRevision: number;
};

export function isChangeableRun(
  item: WorkspaceCalendarItem,
): item is ChangeableRun {
  return (
    item.canChangeRun &&
    item.scheduleId !== null &&
    item.scheduleRevision !== null
  );
}

/** Sends one Run change with the schedule revision the Calendar read. */
export function changeRun(item: ChangeableRun, change: RunChange) {
  return changeTaskScheduleRun({
    scheduleId: item.scheduleId,
    runId: item.id,
    expectedRevision: item.scheduleRevision,
    ...change,
  });
}

const RUN_CHANGE_ERROR_KEYS = {
  stale: "event.runStale",
  invalid_time: "event.runInvalidTime",
  failed: "event.runError",
} as const satisfies Record<TaskScheduleActionError["kind"], string>;

/** The `App.Calendar` message for a Run change Core refused. */
export function runChangeErrorKey(kind: TaskScheduleActionError["kind"]) {
  return RUN_CHANGE_ERROR_KEYS[kind];
}

/**
 * Tells the viewer a Run change failed. A stale one also reloads the
 * Calendar, since the Runs it shows moved on.
 */
export function useReportRunChangeFailure() {
  const t = useTranslations("App.Calendar");
  const router = useRouter();
  return (kind: TaskScheduleActionError["kind"]) => {
    if (kind === "stale") {
      router.refresh();
    }
    toast.error(t(runChangeErrorKey(kind)), { duration: Infinity });
  };
}
