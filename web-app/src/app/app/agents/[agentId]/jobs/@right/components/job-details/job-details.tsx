import { useFormatter, useTranslations } from "next-intl";

import JobStatusBadge from "@/app/agents/[agentId]/jobs/components/job-status-badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobWithRelations } from "@/lib/db/types/job.types";
import { cn } from "@/lib/utils";

import JobDetailsInputs from "./inputs";
import JobDetailsOutputs from "./outputs";

interface JobDetailsProps {
  job: JobWithRelations;
  className?: string | undefined;
}

export default function JobDetails({ job, className }: JobDetailsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails");
  const formatter = useFormatter();

  return (
    <div className={cn("flex h-full min-h-[300px] flex-1 flex-col", className)}>
      <ScrollArea className="h-[calc(100%)] rounded-md border p-4 px-8">
        <h1 className="h-[30px] text-xl font-bold">{t("title")} </h1>
        <p>
          {formatter.dateTime(job.createdAt, {
            dateStyle: "full",
            timeStyle: "short",
          })}
        </p>
        <div className="mt-6 flex flex-1 flex-col gap-4 lg:gap-6">
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">{t("status")}</h1>
            <JobStatusBadge status={job.status} />
          </div>
          <JobDetailsInputs rawInput={job.input} />
          <JobDetailsOutputs rawOutput={job.output} />
        </div>
      </ScrollArea>
    </div>
  );
}
