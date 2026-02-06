import { TaskStatus } from "@sokosumi/database";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.INPUT_REQUIRED]: "Input",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "Auth",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.COMPLETED]: "Done",
  [TaskStatus.FAILED]: "Failed",
};

const STATUS_DOT_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "bg-gray-400",
  [TaskStatus.READY]: "bg-blue-500",
  [TaskStatus.INPUT_REQUIRED]: "bg-orange-500",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "bg-purple-500",
  [TaskStatus.RUNNING]: "bg-amber-500",
  [TaskStatus.COMPLETED]: "bg-emerald-500",
  [TaskStatus.FAILED]: "bg-red-500",
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
  showLabel?: boolean;
}

export function TaskStatusBadge({
  status,
  className,
  showLabel = true,
}: TaskStatusBadgeProps) {
  return (
    <div className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
      <span
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          STATUS_DOT_COLORS[status],
        )}
        aria-hidden
      />
      {showLabel && (
        <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
          {STATUS_LABELS[status]}
        </span>
      )}
    </div>
  );
}
