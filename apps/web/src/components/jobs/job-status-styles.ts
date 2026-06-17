import { SokosumiJobStatus } from "@sokosumi/utils";

interface StatusPillStyle {
  bg: string;
  text: string;
  dot: string;
}

const DEFAULT_STATUS_STYLE: StatusPillStyle = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  dot: "bg-muted-foreground",
};

const STATUS_PILL_STYLES: Partial<Record<SokosumiJobStatus, StatusPillStyle>> =
  {
    [SokosumiJobStatus.COMPLETED]: {
      bg: "bg-stone-500/10",
      text: "text-stone-600 dark:text-stone-400",
      dot: "bg-stone-500",
    },
    [SokosumiJobStatus.REFUND_RESOLVED]: {
      bg: "bg-stone-500/10",
      text: "text-stone-600 dark:text-stone-400",
      dot: "bg-stone-500",
    },
    [SokosumiJobStatus.DISPUTE_RESOLVED]: {
      bg: "bg-stone-500/10",
      text: "text-stone-600 dark:text-stone-400",
      dot: "bg-stone-500",
    },
    [SokosumiJobStatus.FAILED]: {
      bg: "bg-destructive/10",
      text: "text-destructive",
      dot: "bg-red-500",
    },
    [SokosumiJobStatus.PAYMENT_FAILED]: {
      bg: "bg-destructive/10",
      text: "text-destructive",
      dot: "bg-red-500",
    },
    [SokosumiJobStatus.RESULT_PENDING]: {
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
    },
    [SokosumiJobStatus.INPUT_REQUIRED]: {
      bg: "bg-destructive/10",
      text: "text-destructive",
      dot: "bg-orange-500",
    },
    [SokosumiJobStatus.REFUND_PENDING]: {
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
    },
    [SokosumiJobStatus.DISPUTE_PENDING]: {
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
    },
    [SokosumiJobStatus.STARTED]: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    [SokosumiJobStatus.PROCESSING]: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-600 dark:text-emerald-400",
      dot: "bg-emerald-500",
    },
    [SokosumiJobStatus.PAYMENT_PENDING]: {
      bg: "bg-orange-500/10",
      text: "text-orange-600 dark:text-orange-400",
      dot: "bg-orange-500",
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
