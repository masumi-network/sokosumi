"use client";

import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { JobStatus } from "@/prisma/generated/client";

interface JobStatusBadgeProps {
  status: JobStatus;
}

export default function JobStatusBadge({ status }: JobStatusBadgeProps) {
  const t = useTranslations("App.Agents.Jobs.JobsTable.JobStatusBadge");

  switch (status) {
    case JobStatus.COMPLETED:
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          {t("completed")}
        </Badge>
      );
    case JobStatus.FAILED:
      return (
        <Badge variant="default" className="bg-red-100 text-red-800">
          {t("failed")}
        </Badge>
      );
    case JobStatus.PAYMENT_PENDING:
      return (
        <Badge variant="default" className="bg-yellow-100 text-yellow-800">
          {t("paymentPending")}
        </Badge>
      );
    case JobStatus.PROCESSING:
      return (
        <Badge variant="default" className="bg-blue-100 text-blue-800">
          {t("processing")}
        </Badge>
      );
    case JobStatus.PAYMENT_FAILED:
      return (
        <Badge variant="default" className="bg-red-100 text-red-800">
          {t("paymentFailed")}
        </Badge>
      );
    case JobStatus.AGENT_CONNECTION_FAILED:
      return (
        <Badge variant="default" className="bg-red-100 text-red-800">
          {t("agentConnectionFailed")}
        </Badge>
      );
    case JobStatus.PAYMENT_NODE_CONNECTION_FAILED:
      return (
        <Badge variant="default" className="bg-red-100 text-red-800">
          {t("paymentNodeConnectionFailed")}
        </Badge>
      );
    case JobStatus.INPUT_REQUIRED:
      return (
        <Badge variant="default" className="bg-yellow-100 text-yellow-800">
          {t("inputRequired")}
        </Badge>
      );
    case JobStatus.DISPUTE_REQUESTED:
      return (
        <Badge variant="default" className="bg-orange-100 text-orange-800">
          {t("disputeRequested")}
        </Badge>
      );
    case JobStatus.DISPUTE_RESOLVED:
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          {t("disputeResolved")}
        </Badge>
      );
    case JobStatus.REFUND_REQUESTED:
      return (
        <Badge variant="default" className="bg-orange-100 text-orange-800">
          {t("refundRequested")}
        </Badge>
      );
    case JobStatus.REFUND_RESOLVED:
      return (
        <Badge variant="default" className="bg-green-100 text-green-800">
          {t("refundResolved")}
        </Badge>
      );
    case JobStatus.UNKNOWN:
    default:
      return (
        <Badge variant="default" className="bg-gray-100 text-gray-800">
          {t("unknown")}
        </Badge>
      );
  }
}
