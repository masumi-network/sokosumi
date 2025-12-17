"use client";

import { JobType, SokosumiJobStatus } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: SokosumiJobStatus;
  jobType?: JobType;
  className?: string;
}

export function JobStatusBadge({
  status,
  jobType,
  className,
}: JobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.StatusBadge");

  if (jobType === JobType.DEMO) {
    return (
      <Badge
        variant="default"
        className={cn("bg-orange-100 text-orange-800", className)}
      >
        {t("demo")}
      </Badge>
    );
  }

  switch (status) {
    case SokosumiJobStatus.COMPLETED:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("completed")}
        </Badge>
      );
    case SokosumiJobStatus.FAILED:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("failed")}
        </Badge>
      );
    case SokosumiJobStatus.PAYMENT_FAILED:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("paymentFailed")}
        </Badge>
      );
    case SokosumiJobStatus.STARTED:
    case SokosumiJobStatus.PAYMENT_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-sky-100 text-sky-800", className)}
        >
          {t("paymentPending")}
        </Badge>
      );
    case SokosumiJobStatus.PROCESSING:
      return (
        <Badge
          variant="default"
          className={cn("bg-sky-100 text-sky-800", className)}
        >
          {t("processing")}
        </Badge>
      );
    case SokosumiJobStatus.INPUT_REQUIRED:
      return (
        <Badge
          variant="default"
          className={cn("bg-yellow-100 text-yellow-800", className)}
        >
          {t("inputRequired")}
        </Badge>
      );
    case SokosumiJobStatus.REFUND_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("refundRequested")}
        </Badge>
      );
    case SokosumiJobStatus.REFUND_RESOLVED:
      return (
        <Badge
          variant="default"
          className={cn("bg-purple-100 text-purple-800", className)}
        >
          {t("refundResolved")}
        </Badge>
      );
    case SokosumiJobStatus.DISPUTE_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("disputeRequested")}
        </Badge>
      );
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return (
        <Badge
          variant="default"
          className={cn("bg-purple-100 text-purple-800", className)}
        >
          {t("disputeResolved")}
        </Badge>
      );
    case SokosumiJobStatus.RESULT_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("resultPending")}
        </Badge>
      );
    default:
      return (
        <Badge
          variant="default"
          className={cn("bg-gray-100 text-gray-800", className)}
        >
          {t("unknown")}
        </Badge>
      );
  }
}
