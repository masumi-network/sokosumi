import { SokosumiJobStatus } from "@/lib/clients/generated/core";

interface StatusPillStyle {
  bg: string;
  text: string;
  dot: string;
}

const DEFAULT_STATUS_STYLE: StatusPillStyle = {
  bg: "bg-muted",
  text: "text-foreground",
  dot: "bg-status-done",
};

/**
 * Pattern: tinted fill, a vivid dot, and the label in the foreground colour.
 * A coloured label needs 4.5:1, which drags every hue dark enough to go muddy;
 * the dot needs only 3:1 (WCAG 2.2 SC 1.4.11), so the colour stays vivid where
 * it is small.
 *
 * Mirrors `STATUS_PILL_STYLES` in the task status badge, because a job and a
 * task state that mean the same thing must look the same. This file used to
 * paint `COMPLETED` stone while that one painted it emerald.
 *
 * The two `*_RESOLVED` states stay neutral on purpose: the case is closed, and
 * neither outcome is the one the user was hoping for.
 */
const STATUS_PILL_STYLES: Partial<Record<SokosumiJobStatus, StatusPillStyle>> =
  {
    [SokosumiJobStatus.COMPLETED]: {
      bg: "bg-semantic-success-quinary",
      text: "text-foreground",
      dot: "bg-semantic-success",
    },
    [SokosumiJobStatus.REFUND_RESOLVED]: DEFAULT_STATUS_STYLE,
    [SokosumiJobStatus.DISPUTE_RESOLVED]: DEFAULT_STATUS_STYLE,
    [SokosumiJobStatus.FAILED]: {
      bg: "bg-semantic-destructive-quinary",
      text: "text-foreground",
      dot: "bg-semantic-destructive",
    },
    [SokosumiJobStatus.PAYMENT_FAILED]: {
      bg: "bg-semantic-destructive-quinary",
      text: "text-foreground",
      dot: "bg-semantic-destructive",
    },
    [SokosumiJobStatus.INPUT_REQUIRED]: {
      bg: "bg-semantic-destructive-quinary",
      text: "text-foreground",
      dot: "bg-semantic-destructive",
    },
    [SokosumiJobStatus.RESULT_PENDING]: {
      bg: "bg-status-awaiting-quinary",
      text: "text-foreground",
      dot: "bg-status-awaiting",
    },
    [SokosumiJobStatus.REFUND_PENDING]: {
      bg: "bg-semantic-warning-quinary",
      text: "text-foreground",
      dot: "bg-semantic-warning",
    },
    [SokosumiJobStatus.DISPUTE_PENDING]: {
      bg: "bg-semantic-warning-quinary",
      text: "text-foreground",
      dot: "bg-semantic-warning",
    },
    [SokosumiJobStatus.PAYMENT_PENDING]: {
      bg: "bg-semantic-warning-quinary",
      text: "text-foreground",
      dot: "bg-semantic-warning",
    },
    [SokosumiJobStatus.STARTED]: {
      bg: "bg-status-running-quinary",
      text: "text-foreground",
      dot: "bg-status-running",
    },
    [SokosumiJobStatus.PROCESSING]: {
      bg: "bg-status-running-quinary",
      text: "text-foreground",
      dot: "bg-status-running",
    },
  };

export function getJobStatusPillStyle(
  status: SokosumiJobStatus,
): StatusPillStyle {
  return STATUS_PILL_STYLES[status] ?? DEFAULT_STATUS_STYLE;
}

export function getJobStatusDotColorClass(status: SokosumiJobStatus): string {
  return getJobStatusPillStyle(status).dot;
}
