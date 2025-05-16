"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { OnChainJobStatus } from "@/prisma/generated/client";

interface JobStatusBadgeProps {
  status: OnChainJobStatus | null;
  className?: string;
}

export default function JobStatusBadge({
  status,
  className,
}: JobStatusBadgeProps) {
  const t = useTranslations("App.Agents.Jobs.JobsTable.JobStatusBadge");
  console.log("status", status);
  switch (status) {
    case OnChainJobStatus.RESULT_SUBMITTED:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("completed")}
        </Badge>
      );
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("failed")}
        </Badge>
      );
    case null:
      return (
        <Badge
          variant="default"
          className={cn("bg-yellow-100 text-yellow-800", className)}
        >
          {t("paymentProcessing")}
        </Badge>
      );
    case OnChainJobStatus.FUNDS_LOCKED:
      return (
        <Badge
          variant="default"
          className={cn("bg-blue-100 text-blue-800", className)}
        >
          {t("processing")}
        </Badge>
      );
    case OnChainJobStatus.FUNDS_OR_DATUM_INVALID:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("paymentFailed")}
        </Badge>
      );
    // case JobStatus.AGENT_CONNECTION_FAILED:
    //   return (
    //     <Badge
    //       variant="default"
    //       className={cn("bg-red-100 text-red-800", className)}
    //     >
    //       {t("agentConnectionFailed")}
    //     </Badge>
    //   );
    // case JobStatus.PAYMENT_NODE_CONNECTION_FAILED:
    //   return (
    //     <Badge
    //       variant="default"
    //       className={cn("bg-red-100 text-red-800", className)}
    //     >
    //       {t("paymentNodeConnectionFailed")}
    //     </Badge>
    //   );
    // case JobStatus.INPUT_REQUIRED:
    //   return (
    //     <Badge
    //       variant="default"
    //       className={cn("bg-yellow-100 text-yellow-800", className)}
    //     >
    //       {t("inputRequired")}
    //     </Badge>
    //   );
    case OnChainJobStatus.DISPUTED:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("disputeRequested")}
        </Badge>
      );
    case OnChainJobStatus.DISPUTED_WITHDRAWN:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("disputeResolved")}
        </Badge>
      );
    case OnChainJobStatus.REFUND_REQUESTED:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("refundRequested")}
        </Badge>
      );
    case OnChainJobStatus.REFUND_WITHDRAWN:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("refundResolved")}
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
