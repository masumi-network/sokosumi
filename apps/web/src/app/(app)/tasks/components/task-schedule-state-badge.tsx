import { Badge } from "@/components/ui/badge";
import {
  type TaskSchedule,
  TaskScheduleState,
} from "@/lib/clients/generated/core";
import { TaskPrivateIndicator } from "./task-private-indicator";

interface TaskScheduleStateBadgeProps {
  schedule: Pick<TaskSchedule, "state" | "visibility">;
  label: string;
}

/** Active stands out; Paused and Ended recede. Private shows its lock. */
export function TaskScheduleStateBadge({
  schedule,
  label,
}: TaskScheduleStateBadgeProps) {
  return (
    <span className="flex items-center gap-1.5">
      <Badge
        variant={
          schedule.state === TaskScheduleState.ACTIVE ? "secondary" : "outline"
        }
        className="rounded-sm"
      >
        {label}
      </Badge>
      <TaskPrivateIndicator visibility={schedule.visibility} />
    </span>
  );
}
