"use client";

import { JobStatus } from "@prisma/client";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";

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
  }
}
