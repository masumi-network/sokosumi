import { Check, Circle, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AgentJobStatus, Job } from "@/prisma/generated/client";

interface AgentJobStatusIndicatorProps {
  job: Job;
  className?: string | undefined;
}

export default function AgentJobStatusIndicator({
  job,
  className,
}: AgentJobStatusIndicatorProps) {
  const { agentJobStatus } = job;

  return (
    <Tooltip>
      <TooltipTrigger>
        <AgentJobStatusIndicatorIcon
          status={agentJobStatus}
          className={className}
        />
      </TooltipTrigger>
      <TooltipContent>
        <AgentJobStatusIndicatorContent status={agentJobStatus} />
      </TooltipContent>
    </Tooltip>
  );
}

function AgentJobStatusIndicatorIcon({
  status,
  className,
}: {
  status: AgentJobStatus | null;
  className?: string | undefined;
}) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return <Check className={cn(className)} />;
    case AgentJobStatus.FAILED:
      return <X className={cn(className)} />;
    case AgentJobStatus.AWAITING_INPUT:
      return <Circle className={cn(className)} fill="currentColor" />;
    case null:
    case AgentJobStatus.AWAITING_PAYMENT:
      return <Loader2 className={cn("animate-spin", className)} />;
    default:
      return <Loader2 className={cn("animate-spin", className)} />;
  }
}

function AgentJobStatusIndicatorContent({
  status,
}: {
  status: AgentJobStatus | null;
}) {
  const t = useTranslations("App.Sidebar.Content.AgentLists.Statuses");

  switch (status) {
    case AgentJobStatus.COMPLETED:
      return <p>{t("completed")}</p>;
    case AgentJobStatus.FAILED:
      return <p>{t("failed")}</p>;
    case AgentJobStatus.AWAITING_INPUT:
      return <p>{t("inputRequired")}</p>;
    case null:
    case AgentJobStatus.AWAITING_PAYMENT:
      return <p>{t("paymentProcessing")}</p>;
    default:
      return <p>{t("processing")}</p>;
  }
}
