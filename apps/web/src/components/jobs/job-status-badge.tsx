"use client";

import { JobType, SokosumiJobStatus } from "@sokosumi/database";
import { useTranslations } from "next-intl";

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
      return "bg-red-500";
    case SokosumiJobStatus.INPUT_REQUIRED:
      return "bg-yellow-500";
    case SokosumiJobStatus.REFUND_PENDING:
    case SokosumiJobStatus.DISPUTE_PENDING:
      return "bg-orange-500";
    case SokosumiJobStatus.STARTED:
    case SokosumiJobStatus.PAYMENT_PENDING:
    case SokosumiJobStatus.PROCESSING:
    case SokosumiJobStatus.RESULT_PENDING:
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
  const label = t(statusToLabelKey(status, jobType));
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

function statusToLabelKey(status: SokosumiJobStatus, jobType?: JobType) {
  if (jobType === JobType.DEMO) {
    return "demo";
  }

  switch (status) {
    case SokosumiJobStatus.COMPLETED:
      return "completed";
    case SokosumiJobStatus.FAILED:
      return "failed";
    case SokosumiJobStatus.PAYMENT_FAILED:
      return "paymentFailed";
    case SokosumiJobStatus.STARTED:
    case SokosumiJobStatus.PAYMENT_PENDING:
      return "paymentPending";
    case SokosumiJobStatus.PROCESSING:
      return "processing";
    case SokosumiJobStatus.INPUT_REQUIRED:
      return "inputRequired";
    case SokosumiJobStatus.REFUND_PENDING:
      return "refundRequested";
    case SokosumiJobStatus.REFUND_RESOLVED:
      return "refundResolved";
    case SokosumiJobStatus.DISPUTE_PENDING:
      return "disputeRequested";
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return "disputeResolved";
    case SokosumiJobStatus.RESULT_PENDING:
      return "resultPending";
    default:
      return "unknown";
  }
}
