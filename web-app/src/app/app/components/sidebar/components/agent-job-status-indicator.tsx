import { Check, Circle, Loader2, X } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { JobStatus, JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

interface AgentJobStatusIndicatorProps {
  job: JobWithStatus;
  className?: string | undefined;
}

export default function AgentJobStatusIndicator({
  job,
  className,
}: AgentJobStatusIndicatorProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <AgentJobStatusIndicatorIcon
          status={job.status}
          className={className}
        />
      </TooltipTrigger>
      <TooltipContent>
        <AgentJobStatusIndicatorContent status={job.status} />
      </TooltipContent>
    </Tooltip>
  );
}

function AgentJobStatusIndicatorIcon({
  status,
  className,
}: {
  status: JobStatus;
  className?: string | undefined;
}) {
  switch (status) {
    case JobStatus.COMPLETED:
      return <Check className={cn(className)} />;
    case JobStatus.FAILED:
      return <X className={cn(className)} />;
    case JobStatus.INPUT_REQUIRED:
      return <Circle className={cn(className)} fill="currentColor" />;
    default:
      return <Loader2 className={cn("animate-spin", className)} />;
  }
}

function AgentJobStatusIndicatorContent({ status }: { status: JobStatus }) {
  const t = useTranslations("App.Sidebar.Content.AgentLists.Statuses");

  switch (status) {
    case JobStatus.COMPLETED:
      return <p>{t("completed")}</p>;
    case JobStatus.FAILED:
      return <p>{t("failed")}</p>;
    case JobStatus.INPUT_REQUIRED:
      return <p>{t("inputRequired")}</p>;
    default:
      return <p>{t("processing")}</p>;
  }
}
