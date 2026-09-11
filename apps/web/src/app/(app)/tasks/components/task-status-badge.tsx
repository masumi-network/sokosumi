import { CircleAlert } from "lucide-react";
import { TaskStatus } from "@/lib/clients/generated/core";

import { cn } from "@/lib/utils";

const STATUS_LABELS: Partial<Record<TaskStatus, string>> = {
  [TaskStatus.DRAFT]: "Draft",
  [TaskStatus.QUEUED]: "Queued",
  [TaskStatus.READY]: "Ready",
  [TaskStatus.INPUT_REQUIRED]: "Input required",
  [TaskStatus.APPROVAL_REQUIRED]: "Approval required",
  [TaskStatus.GRANT_PENDING]: "Grant pending",
  [TaskStatus.AUTHENTICATION_REQUIRED]: "Authentication required",
  [TaskStatus.OUT_OF_CREDITS]: "Paused: credits needed",
  [TaskStatus.CREDITS_TOPPED_UP]: "Credits topped up",
  [TaskStatus.RUNNING]: "Running",
  [TaskStatus.AWAITING_EXTERNAL]: "Awaiting external",
  [TaskStatus.COMPLETED]: "Complete",
  [TaskStatus.FAILED]: "Failed",
  [TaskStatus.CANCELED]: "Canceled",
};

/**
 * Pattern: tinted fill, a vivid dot, and the label in the foreground colour.
 * A coloured label needs 4.5:1, which forces every hue dark enough to go
 * muddy; the dot needs only 3:1 (WCAG 2.2 SC 1.4.11), so the colour stays
 * vivid where it is small.
 *
 * Statuses that mean the same thing share a ramp. Statuses with different
 * purposes keep different hues: running is not succeeded, and collapsing them
 * would throw away what the colour is there to say. Every value is a token —
 * the raw Tailwind palette this used to reach for was a second colour system,
 * and it painted "succeeded" emerald here while the job badge painted it
 * green.
 */
const STATUS_PILL_STYLES: Partial<
  Record<TaskStatus, { bg: string; text: string; dot: string }>
> = {
  [TaskStatus.DRAFT]: {
    bg: "bg-muted",
    text: "text-foreground",
    dot: "bg-status-done",
  },
  [TaskStatus.QUEUED]: {
    bg: "bg-primary-quinary",
    text: "text-foreground",
    dot: "bg-primary",
  },
  [TaskStatus.READY]: {
    bg: "bg-status-ready-quinary",
    text: "text-foreground",
    dot: "bg-status-ready",
  },
  [TaskStatus.INPUT_REQUIRED]: {
    bg: "bg-semantic-destructive-quinary",
    text: "text-foreground",
    dot: "bg-semantic-destructive",
  },
  [TaskStatus.APPROVAL_REQUIRED]: {
    bg: "bg-semantic-warning-quinary",
    text: "text-foreground",
    dot: "bg-semantic-warning",
  },
  [TaskStatus.GRANT_PENDING]: {
    bg: "bg-semantic-warning-quinary",
    text: "text-foreground",
    dot: "bg-semantic-warning",
  },
  [TaskStatus.AUTHENTICATION_REQUIRED]: {
    bg: "bg-status-auth-quinary",
    text: "text-foreground",
    dot: "bg-status-auth",
  },
  [TaskStatus.OUT_OF_CREDITS]: {
    bg: "bg-semantic-destructive-quinary",
    text: "text-foreground",
    dot: "bg-semantic-destructive",
  },
  [TaskStatus.CREDITS_TOPPED_UP]: {
    bg: "bg-status-topped-up-quinary",
    text: "text-foreground",
    dot: "bg-status-topped-up",
  },
  [TaskStatus.RUNNING]: {
    bg: "bg-status-running-quinary",
    text: "text-foreground",
    dot: "bg-status-running",
  },
  [TaskStatus.AWAITING_EXTERNAL]: {
    bg: "bg-status-awaiting-quinary",
    text: "text-foreground",
    dot: "bg-status-awaiting",
  },
  [TaskStatus.COMPLETED]: {
    bg: "bg-semantic-success-quinary",
    text: "text-foreground",
    dot: "bg-semantic-success",
  },
  [TaskStatus.FAILED]: {
    bg: "bg-semantic-destructive-quinary",
    text: "text-foreground",
    dot: "bg-semantic-destructive",
  },
  [TaskStatus.CANCELED]: {
    bg: "bg-muted",
    text: "text-foreground",
    dot: "bg-status-done",
  },
};

export function getTaskStatusDotColorClass(status: TaskStatus): string {
  return STATUS_PILL_STYLES[status]?.dot ?? "bg-muted-foreground";
}

export function getTaskStatusBorderColorClass(status: TaskStatus): string {
  if (status === TaskStatus.COMPLETED) {
    return "border-semantic-success-tertiary";
  }

  return "border-border";
}

function getTaskStatusLabel(status: TaskStatus): string {
  return STATUS_LABELS[status] ?? "Unknown";
}

function shouldShowWarningIcon(status: TaskStatus): boolean {
  return (
    status === TaskStatus.INPUT_REQUIRED ||
    status === TaskStatus.APPROVAL_REQUIRED ||
    status === TaskStatus.OUT_OF_CREDITS
  );
}

function shouldShowStatusDot(showDot: boolean | undefined): boolean {
  return showDot === true;
}

function getBadgeShapeClasses(): string {
  return "rounded-sm py-1";
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
  showDot,
  showLabel = true,
}: TaskStatusBadgeProps) {
  const pill = STATUS_PILL_STYLES[status] ?? {
    bg: "bg-muted",
    text: "text-foreground",
    dot: "bg-status-done",
  };
  // The icon stands in for the dot, so it takes the dot's colour. `bg-` becomes
  // `text-` because the same token paints a fill there and a stroke here.
  const styles = { ...pill, icon: pill.dot.replace("bg-", "text-") };
  const showIcon = shouldShowWarningIcon(status);
  const showStatusDot = shouldShowStatusDot(showDot);

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 px-2.5 text-xs font-medium",
        getBadgeShapeClasses(),
        styles.bg,
        styles.text,
        className,
      )}
    >
      {showStatusDot && !showIcon ? (
        <span
          className={cn("size-1.5 shrink-0 rounded-full", styles.dot)}
          aria-hidden
        />
      ) : null}
      {showIcon ? (
        <CircleAlert
          className={cn("size-3 shrink-0", styles.icon)}
          aria-hidden
        />
      ) : null}
      {showLabel && <span>{label ?? getTaskStatusLabel(status)}</span>}
    </span>
  );
}
