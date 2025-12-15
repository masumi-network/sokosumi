"use client";

import { AgentJobStatus } from "@sokosumi/database";
import { useTranslations } from "next-intl";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface AgentJobStatusBadgeProps {
  status: AgentJobStatus;
  className?: string;
}

export function AgentJobStatusBadge({
  status,
  className,
}: AgentJobStatusBadgeProps) {
  const t = useTranslations("Components.Jobs.AgentStatusBadge");

  switch (status) {
    case AgentJobStatus.INITIATED:
      return (
        <Badge
          variant="default"
          className={cn("bg-sky-100 text-sky-800", className)}
        >
          {t("initiated")}
        </Badge>
      );
    case AgentJobStatus.AWAITING_PAYMENT:
      return (
        <Badge
          variant="default"
          className={cn("bg-orange-100 text-orange-800", className)}
        >
          {t("awaitingPayment")}
        </Badge>
      );
    case AgentJobStatus.AWAITING_INPUT:
      return (
        <Badge
          variant="default"
          className={cn("bg-yellow-100 text-yellow-800", className)}
        >
          {t("awaitingInput")}
        </Badge>
      );
    case AgentJobStatus.RUNNING:
      return (
        <Badge
          variant="default"
          className={cn("bg-sky-100 text-sky-800", className)}
        >
          {t("running")}
        </Badge>
      );
    case AgentJobStatus.COMPLETED:
      return (
        <Badge
          variant="default"
          className={cn("bg-green-100 text-green-800", className)}
        >
          {t("completed")}
        </Badge>
      );
    case AgentJobStatus.FAILED:
      return (
        <Badge
          variant="default"
          className={cn("bg-red-100 text-red-800", className)}
        >
          {t("failed")}
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
