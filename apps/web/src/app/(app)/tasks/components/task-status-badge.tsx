import { TaskStatus } from "@sokosumi/database";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.INPUT_REQUIRED]: "Input Required",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.COMPLETED]: "Completed",
  [TaskStatus.FAILED]: "Failed",
};

const STATUS_CLASSES: Record<TaskStatus, string> = {
  [TaskStatus.DRAFT]: "bg-gray-100 text-gray-800",
  [TaskStatus.READY]: "bg-sky-100 text-sky-800",
  [TaskStatus.INPUT_REQUIRED]: "bg-yellow-100 text-yellow-800",
  [TaskStatus.RUNNING]: "bg-sky-100 text-sky-800",
  [TaskStatus.COMPLETED]: "bg-green-100 text-green-800",
  [TaskStatus.FAILED]: "bg-red-100 text-red-800",
};

interface TaskStatusBadgeProps {
  status: TaskStatus;
  className?: string;
}

export function TaskStatusBadge({ status, className }: TaskStatusBadgeProps) {
  return (
    <Badge variant="default" className={cn(STATUS_CLASSES[status], className)}>
      {STATUS_LABELS[status]}
    </Badge>
  );
}
