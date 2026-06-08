"use client";

import { JobType } from "@sokosumi/database";
import { SokosumiJobStatus } from "@sokosumi/utils";
import { useTranslations } from "next-intl";

import { getJobStatusBadgeLabelKey } from "@/components/jobs/job-status-label";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  jobType?: JobType;
  className?: string;
  variant?: "badge" | "dot";
}

export function getJobStatusDotColorClass(
  status: SokosumiJobStatus,
  jobType?: JobType,
) {
  if (jobType === JobType.DEMO) return "bg-orange-500";

  switch (status) {
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return "bg-green-500";
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
    case SokosumiJobStatus.RESULT_PENDING:
      return "bg-red-500";
    case SokosumiJobStatus.INPUT_REQUIRED:
      return "bg-yellow-500";
    case SokosumiJobStatus.REFUND_PENDING:
    case SokosumiJobStatus.DISPUTE_PENDING:
      return "bg-orange-500";
    case SokosumiJobStatus.STARTED:
    case SokosumiJobStatus.PAYMENT_PENDING:
    case SokosumiJobStatus.PROCESSING:
    default:
      return "bg-sky-500";
  }
}

export function JobStatusBadge({
  status,
  jobType,
  className,
  variant = "badge",
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");
  const label = t(getJobStatusBadgeLabelKey(status, jobType));
  const dotClass = getJobStatusDotColorClass(status, jobType);

  if (variant === "dot") {
    return (
      <span
        aria-label={label}
        className={cn(
          "inline-flex size-1.5 shrink-0 rounded-full",
          dotClass,
          className,
        )}
      />
    );
  }

  return (
    <div className={cn("inline-flex shrink-0 items-center gap-1.5", className)}>
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dotClass)}
        aria-hidden
      />
      <span className="text-muted-foreground text-[10px] font-medium tracking-wider uppercase">
        {label}
      </span>
    </div>
  );
}
