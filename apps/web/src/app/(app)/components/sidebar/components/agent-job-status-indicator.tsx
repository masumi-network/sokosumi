"use client";

import { SokosumiJobStatus } from "@sokosumi/database";
import { Check, Circle, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import useAgentJobStatusData from "@/hooks/use-agent-job-status";
import { type JobStatusData } from "@/lib/ably";
import { cn } from "@/lib/utils";

interface AgentJobStatusIndicatorProps {
  agentId: string;
  userId: string;
  initialJobStatusData: JobStatusData | null;
  className?: string | undefined;
}

export default function AgentJobStatusIndicator({
  agentId,
  userId,
  initialJobStatusData,
  className,
}: AgentJobStatusIndicatorProps) {
  const jobStatusData =
    useAgentJobStatusData(agentId, userId, null) ?? initialJobStatusData;

  if (!jobStatusData) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger>
        <AgentJobStatusIndicatorIcon
          jobStatusData={jobStatusData}
          className={className}
        />
      </TooltipTrigger>
      <TooltipContent>
        <AgentJobStatusIndicatorContent jobStatusData={jobStatusData} />
      </TooltipContent>
    </Tooltip>
  );
}

function AgentJobStatusIndicatorIcon({
  jobStatusData,
  className,
}: {
  jobStatusData: JobStatusData;
  className?: string | undefined;
}) {
  const { jobStatus, jobStatusSettled } = jobStatusData;
  if (jobStatusSettled) {
    return null;
  }

  switch (jobStatus) {
    case SokosumiJobStatus.COMPLETED:
    case SokosumiJobStatus.REFUND_RESOLVED:
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return <Check className={cn(className)} />;
    case SokosumiJobStatus.FAILED:
    case SokosumiJobStatus.PAYMENT_FAILED:
      return <X className={cn(className)} />;
    case SokosumiJobStatus.INPUT_REQUIRED:
      return <Circle className={cn(className)} fill="currentColor" />;
    case SokosumiJobStatus.PAYMENT_PENDING:
    case SokosumiJobStatus.PROCESSING:
    case SokosumiJobStatus.RESULT_PENDING:
    case SokosumiJobStatus.REFUND_PENDING:
    case SokosumiJobStatus.DISPUTE_PENDING:
      return <Loader2 className={cn("animate-spin", className)} />;
    default:
      return null;
  }
}

function AgentJobStatusIndicatorContent({
  jobStatusData,
}: {
  jobStatusData: JobStatusData;
}) {
  const t = useTranslations("App.Sidebar.Content.AgentLists.Statuses");

  const { jobStatus, jobStatusSettled } = jobStatusData;
  if (jobStatusSettled) {
    return null;
  }

  switch (jobStatus) {
    case SokosumiJobStatus.COMPLETED:
      return <p>{t("completed")}</p>;
    case SokosumiJobStatus.REFUND_RESOLVED:
      return <p>{t("refundResolved")}</p>;
    case SokosumiJobStatus.DISPUTE_RESOLVED:
      return <p>{t("disputeResolved")}</p>;
    case SokosumiJobStatus.FAILED:
      return <p>{t("failed")}</p>;
    case SokosumiJobStatus.PAYMENT_FAILED:
      return <p>{t("paymentFailed")}</p>;
    case SokosumiJobStatus.PAYMENT_PENDING:
      return <p>{t("paymentPending")}</p>;
    case SokosumiJobStatus.PROCESSING:
      return <p>{t("processing")}</p>;
    case SokosumiJobStatus.INPUT_REQUIRED:
      return <p>{t("inputRequired")}</p>;
    case SokosumiJobStatus.REFUND_PENDING:
      return <p>{t("refundRequested")}</p>;
    case SokosumiJobStatus.DISPUTE_PENDING:
      return <p>{t("disputeRequested")}</p>;
    case SokosumiJobStatus.RESULT_PENDING:
      return <p>{t("resultPending")}</p>;
    default:
      return null;
  }
}
