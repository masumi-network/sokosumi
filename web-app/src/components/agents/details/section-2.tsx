import { CircleCheck, SquareTerminal } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";
import {
  AgentWithRelations,
  FinalizedJobStatuses,
  getAgentAuthorName,
  JobWithRelations,
} from "@/lib/db";

function AgentDetailSection2({
  agent,
  jobs,
}: {
  agent: AgentWithRelations;
  jobs: JobWithRelations[];
}) {
  const t = useTranslations("Components.Agents.AgentDetail.Section2");
  const formatter = useFormatter();

  const executedJobs = jobs.filter((job) =>
    FinalizedJobStatuses.includes(job.status),
  );

  return (
    <div className="grid grid-cols-2">
      {/* Developer */}
      <div className="flex flex-col gap-0.5 border-r pr-6">
        <div className="flex items-center gap-1.5">
          <SquareTerminal size={16} />
          <span className="text-upper text-xs">{t("developer")}</span>
        </div>
        <p className="text-base font-medium">{getAgentAuthorName(agent)}</p>
      </div>
      {/* Executed Jobs */}
      <div className="flex flex-col gap-0.5 px-6">
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
    </div>
  );
}

function AgentDetailSection2Skeleton() {
  return (
    <div className="grid grid-cols-4">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex flex-col gap-0.5 px-3">
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 w-12" />
          </div>
          <Skeleton className="h-6 w-24" />
        </div>
      ))}
    </div>
  );
}

export { AgentDetailSection2, AgentDetailSection2Skeleton };
