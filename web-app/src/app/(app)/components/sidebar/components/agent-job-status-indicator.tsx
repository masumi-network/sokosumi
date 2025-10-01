"use client";

import { Check, Circle, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useAgentJobStatus from "@/hooks/use-agent-job-status";
import { JobIndicatorStatus } from "@/lib/ably";
import { JobStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentJobStatusIndicatorProps {
  agentId: string;
  userId: string;
  initialJobIndicatorStatus: JobIndicatorStatus | null;
  className?: string | undefined;
}

export default function AgentJobStatusIndicator({
  agentId,
  userId,
  initialJobIndicatorStatus: initialJobStatusData,
  className,
}: AgentJobStatusIndicatorProps) {
  const jobStatusData = useAgentJobStatus(
    agentId,
    userId,
    null,
    initialJobStatusData,
  );

  if (!jobStatusData) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <AgentJobStatusIndicatorIcon
          jobIndicatorStatus={jobStatusData}
          className={className}
        />
      </TooltipTrigger>
      <TooltipContent>
        <AgentJobStatusIndicatorContent jobIndicatorStatus={jobStatusData} />
      </TooltipContent>
    </Tooltip>
  );
}

function AgentJobStatusIndicatorIcon({
  jobIndicatorStatus,
  className,
}: {
  jobIndicatorStatus: JobIndicatorStatus;
  className?: string | undefined;
}) {
  const { jobStatus, jobStatusSettled } = jobIndicatorStatus;
  if (jobStatusSettled) {
    return null;
  }

  switch (jobStatus) {
    case JobStatus.COMPLETED:
    case JobStatus.REFUND_RESOLVED:
    case JobStatus.DISPUTE_RESOLVED:
      return <Check className={cn(className)} />;
    case JobStatus.FAILED:
    case JobStatus.PAYMENT_FAILED:
      return <X className={cn(className)} />;
    case JobStatus.INPUT_REQUIRED:
      return <Circle className={cn(className)} fill="currentColor" />;
    case JobStatus.PAYMENT_PENDING:
    case JobStatus.PROCESSING:
    case JobStatus.RESULT_PENDING:
    case JobStatus.REFUND_PENDING:
    case JobStatus.DISPUTE_PENDING:
      return <Loader2 className={cn("animate-spin", className)} />;
    default:
      return null;
  }
}

function AgentJobStatusIndicatorContent({
  jobIndicatorStatus,
}: {
  jobIndicatorStatus: JobIndicatorStatus;
}) {
  const t = useTranslations("App.Sidebar.Content.AgentLists.Statuses");

  const { jobStatus, jobStatusSettled } = jobIndicatorStatus;
  if (jobStatusSettled) {
    return null;
  }

  switch (jobStatus) {
    case JobStatus.COMPLETED:
      return <p>{t("completed")}</p>;
    case JobStatus.REFUND_RESOLVED:
      return <p>{t("refundResolved")}</p>;
    case JobStatus.DISPUTE_RESOLVED:
      return <p>{t("disputeResolved")}</p>;
    case JobStatus.FAILED:
      return <p>{t("failed")}</p>;
    case JobStatus.PAYMENT_FAILED:
      return <p>{t("paymentFailed")}</p>;
    case JobStatus.PAYMENT_PENDING:
      return <p>{t("paymentPending")}</p>;
    case JobStatus.PROCESSING:
      return <p>{t("processing")}</p>;
    case JobStatus.INPUT_REQUIRED:
      return <p>{t("inputRequired")}</p>;
    case JobStatus.REFUND_PENDING:
      return <p>{t("refundRequested")}</p>;
    case JobStatus.DISPUTE_PENDING:
      return <p>{t("disputeRequested")}</p>;
    case JobStatus.RESULT_PENDING:
      return <p>{t("resultPending")}</p>;
    default:
      return null;
  }
}
