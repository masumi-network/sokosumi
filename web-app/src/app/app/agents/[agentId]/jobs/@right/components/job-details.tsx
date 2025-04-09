import { ScrollArea } from "@radix-ui/react-scroll-area";
import { useFormatter, useTranslations } from "next-intl";
import Markdown from "react-markdown";

import JobStatusBadge from "@/app/agents/[agentId]/jobs/@right/components/job-status-badge";
import { JobWithRelations } from "@/lib/db/types/job.types";
import { cn } from "@/lib/utils";

interface JobDetailsProps {
  job: JobWithRelations;
  className?: string | undefined;
}

function JobDetails({ job, className }: JobDetailsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails");
  const formatter = useFormatter();
  const result = job.output ? JSON.parse(job.output) : null;
  const output = result?.result?.raw.toString();
  const input = job.input ? JSON.parse(job.input) : {};

  return (
    <div className={cn("flex h-full min-h-[300px] flex-1 flex-col", className)}>
      <ScrollArea className="h-[calc(100%)] overflow-y-scroll rounded-md border p-4 px-8">
        <h1 className="h-[30px] text-xl font-bold">{t("title")} </h1>
        <p>
          {" "}
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
          {/* inputs */}
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">{t("Input.title")}</h1>
            {Object.keys(input).length > 0 ? (
              <div>
                {Object.entries(input).map(([key, value]) => (
                  <div className="flex flex-row gap-2" key={key}>
                    <p className="text-base font-bold">{key}</p>
                    <p>
                      {typeof value === "object"
                        ? JSON.stringify(value)
                        : String(value)}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-base">{t("Input.None")}</p>
            )}
          </div>
          {/* outputs */}
          <div className="flex flex-col gap-2">
            <h1 className="text-xl font-bold">{t("Output.title")}</h1>
            {job.output ? (
              <Markdown>{output}</Markdown>
            ) : (
              <p className="text-base">{t("Output.None")}</p>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}

export { JobDetails };
