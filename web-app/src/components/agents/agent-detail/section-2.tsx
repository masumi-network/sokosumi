import { CircleCheck } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import {
  finalizedOnChainJobStatuses,
  JobWithLimitedInformation,
} from "@/lib/db";

function AgentDetailSection2({ jobs }: { jobs: JobWithLimitedInformation[] }) {
  const t = useTranslations("Components.Agents.AgentDetail.Section2");
  const formatter = useFormatter();

  const executedJobs = jobs.filter(
    (job) =>
      job.onChainStatus !== null &&
      finalizedOnChainJobStatuses.includes(job.onChainStatus),
  );

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <CircleCheck size={16} />
        <span className="text-upper text-xs">{t("executedJobs")}</span>
      </div>
      <p className="text-base font-medium">
        {formatter.number(executedJobs.length, {
          notation: "compact",
        })}
      </p>
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
