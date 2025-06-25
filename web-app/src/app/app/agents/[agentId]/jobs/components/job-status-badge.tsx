"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { JobStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

interface JobStatusBadgeProps {
  status: JobStatus;
  className?: string;
}

export default function JobStatusBadge({
  status,
  className,
}: JobStatusBadgeProps) {
  const t = useTranslations("App.Agents.Jobs.StatusBadge");
  switch (status) {
    case JobStatus.COMPLETED:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("completed")}
        </Badge>
      );
    case JobStatus.FAILED:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("failed")}
        </Badge>
      );
    case JobStatus.PAYMENT_FAILED:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("paymentFailed")}
        </Badge>
      );
    case JobStatus.PAYMENT_PENDING:
    case JobStatus.PROCESSING:
      return (
        <Badge
          variant="default"
          className={cn("bg-sky-100 text-sky-800", className)}
        >
          {t("processing")}
        </Badge>
      );
    case JobStatus.INPUT_REQUIRED:
      return (
        <Badge
          variant="default"
          className={cn("bg-yellow-100 text-yellow-800", className)}
        >
          {t("inputRequired")}
        </Badge>
      );
    case JobStatus.REFUND_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("refundRequested")}
        </Badge>
      );
    case JobStatus.REFUND_RESOLVED:
      return (
        <Badge
          variant="default"
          className={cn("bg-purple-100 text-purple-800", className)}
        >
          {t("refundResolved")}
        </Badge>
      );
    case JobStatus.DISPUTE_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("disputeRequested")}
        </Badge>
      );
    case JobStatus.DISPUTE_RESOLVED:
      return (
        <Badge
          variant="default"
          className={cn("bg-purple-100 text-purple-800", className)}
        >
          {t("disputeResolved")}
        </Badge>
      );
    case JobStatus.OUTPUT_PENDING:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("outputPending")}
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
