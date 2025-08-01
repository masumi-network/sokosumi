import { CircleCheck, Clock } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration } from "@/lib/utils";

function AgentDetailSection2({
  executedJobsCount,
  averageExecutionDuration,
}: {
  executedJobsCount: number;
  averageExecutionDuration: number;
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Section2");
  const formatter = useFormatter();
  const tDuration = useTranslations("Library.Duration.Long");

  const formattedDuration = formatDuration(averageExecutionDuration, tDuration);

  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5">
          <CircleCheck size={16} />
          <span className="text-upper text-xs">{t("executedJobs")}</span>
        </div>
        <p className="text-base">
          {formatter.number(executedJobsCount, {
            notation: "compact",
          })}
        </p>
      </div>
      {averageExecutionDuration > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Clock size={16} />
            <span className="text-upper text-xs">
              {t("averageExecutionTime")}
            </span>
          </div>
          <p className="text-base">{formattedDuration}</p>
        </div>
      )}
    </div>
  );
}

function AgentDetailSection2Skeleton() {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <Skeleton className="h-4 w-4" />
        <Skeleton className="h-4 w-12" />
      </div>
      <Skeleton className="h-6 w-24" />
    </div>
  );
}

export { AgentDetailSection2, AgentDetailSection2Skeleton };
