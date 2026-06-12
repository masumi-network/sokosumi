"use client";

import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { CircleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { cn } from "@/lib/utils";

interface StatusPillStyle {
  bg: string;
  text: string;
  dot: string;
}

const DEMO_JOB_STYLE: StatusPillStyle = {
  bg: "bg-orange-500/10",
  text: "text-orange-600 dark:text-orange-400",
  dot: "bg-orange-500",
};

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

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  jobType?: JobType;
  className?: string;
  variant?: "badge" | "dot";
}

function getStatusPillStyle(
  status: SokosumiJobStatus,
  jobType?: JobType,
): StatusPillStyle {
  if (jobType === JobType.DEMO) {
    return DEMO_JOB_STYLE;
  }

  return STATUS_PILL_STYLES[status] ?? DEFAULT_STATUS_STYLE;
}

export function getJobStatusDotColorClass(
  status: SokosumiJobStatus,
  jobType?: JobType,
) {
  return getStatusPillStyle(status, jobType).dot;
}

function shouldShowWarningIcon(status: SokosumiJobStatus): boolean {
  return status === SokosumiJobStatus.INPUT_REQUIRED;
}

export function JobStatusBadge({
  status,
  jobType,
  className,
  variant = "badge",
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status, jobType));
  const styles = getStatusPillStyle(status, jobType);
  const showIcon = shouldShowWarningIcon(status);

  if (variant === "dot") {
    return (
      <span
        aria-label={label}
        className={cn(
          "inline-flex size-1.5 shrink-0 rounded-full",
          styles.dot,
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-medium",
        styles.bg,
        styles.text,
        className,
      )}
    >
      {showIcon ? <CircleAlert className="size-3" aria-hidden /> : null}
      <span>{label}</span>
    </span>
  );
}
