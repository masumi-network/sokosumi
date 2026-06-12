import { TaskStatus } from "@sokosumi/utils";
import { CircleAlert } from "lucide-react";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.INPUT_REQUIRED]: "Approval required",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "Auth",
  [TaskStatus.OUT_OF_CREDITS]: "Paused: credits needed",
  [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
  [TaskStatus.COMPLETED]: "Done",
  [TaskStatus.FAILED]: "Failed",
  [TaskStatus.CANCEL_REQUESTED]: "Cancel requested",
  [TaskStatus.CANCELED]: "Canceled",
};

const STATUS_PILL_STYLES: Partial<
  Record<TaskStatus, { bg: string; text: string; dot: string }>
> = {
  [TaskStatus.DRAFT]: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-gray-400",
  },
  [TaskStatus.READY]: {
    bg: "bg-blue-500/10",
    text: "text-blue-600 dark:text-blue-400",
    dot: "bg-blue-500",
  },
  [TaskStatus.INPUT_REQUIRED]: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-orange-500",
  },
  [TaskStatus.AUTHENTICATION_REQUIRED]: {
    bg: "bg-purple-500/10",
    text: "text-purple-600 dark:text-purple-400",
    dot: "bg-purple-500",
  },
  [TaskStatus.OUT_OF_CREDITS]: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-rose-500",
  },
  [TaskStatus.CREDITS_TOPPED_UP]: {
    bg: "bg-cyan-500/10",
    text: "text-cyan-600 dark:text-cyan-400",
    dot: "bg-cyan-500",
  },
  [TaskStatus.RUNNING]: {
    bg: "bg-success/10",
    text: "text-success",
    dot: "bg-amber-500",
  },
  [TaskStatus.AWAITING_EXTERNAL]: {
    bg: "bg-sky-500/10",
    text: "text-sky-600 dark:text-sky-400",
    dot: "bg-sky-500",
  },
  [TaskStatus.COMPLETED]: {
    bg: "bg-success/10",
    text: "text-success",
    dot: "bg-emerald-500",
  },
  [TaskStatus.FAILED]: {
    bg: "bg-destructive/10",
    text: "text-destructive",
    dot: "bg-red-500",
  },
  [TaskStatus.CANCEL_REQUESTED]: {
    bg: "bg-fuchsia-500/10",
    text: "text-fuchsia-600 dark:text-fuchsia-400",
    dot: "bg-fuchsia-500",
  },
  [TaskStatus.CANCELED]: {
    bg: "bg-muted",
    text: "text-muted-foreground",
    dot: "bg-muted-foreground",
  },
};

export function getTaskStatusDotColorClass(status: TaskStatus): string {
  return STATUS_PILL_STYLES[status]?.dot ?? "bg-muted-foreground";
}

export function getTaskStatusBorderColorClass(status: TaskStatus): string {
  if (status === TaskStatus.COMPLETED) {
    return "border-emerald-500/40";
  }

  return "border-border";
}

function getTaskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? "Unknown";
}

function shouldShowWarningIcon(status: TaskStatus): boolean {
  return (
    status === TaskStatus.INPUT_REQUIRED || status === TaskStatus.OUT_OF_CREDITS
  );
}

interface TaskStatusBadgeProps {
  status: TaskStatus;
  /** When set, overrides the default English label (e.g. from next-intl). */
  label?: string;
  className?: string;
  showDot?: boolean;
  showLabel?: boolean;
}

export function TaskStatusBadge({
  status,
  label,
  className,
  showDot = false,
  showLabel = true,
}: TaskStatusBadgeProps) {
  const styles = STATUS_PILL_STYLES[status] ?? {
    bg: "bg-muted",
    text: "text-muted-foreground",
  };
  const showIcon = shouldShowWarningIcon(status);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        styles.bg,
        styles.text,
        className,
      )}
    >
      {showDot && !showIcon ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", styles.text)}
          aria-hidden
        />
      ) : null}
      {showIcon ? <CircleAlert className="size-3" aria-hidden /> : null}
      {showLabel && <span>{label ?? getTaskStatusLabel(status)}</span>}
    </span>
  );
}
