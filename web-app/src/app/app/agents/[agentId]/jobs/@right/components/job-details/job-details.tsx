import { useFormatter, useTranslations } from "next-intl";

import AccordionItemWrapper from "@/app/agents/[agentId]/jobs/components/accordion-wrapper";
import JobStatusBadge from "@/app/agents/[agentId]/jobs/components/job-status-badge";
import { Accordion } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobStatus, JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

import JobDetailsInputs from "./inputs";
import JobDetailsOutputs from "./outputs";

interface JobDetailsProps {
  job: JobWithStatus;
  className?: string;
}

export default function JobDetails({ job, className }: JobDetailsProps) {
  const t = useTranslations("App.Agents.Jobs.JobDetails");
  return (
    <div className={cn("flex h-full min-h-[300px] flex-1 flex-col", className)}>
      <ScrollArea className="h-full">
        <Accordion
          type="multiple"
          defaultValue={["input", "output"]}
          className="w-full space-y-1.5"
        >
          <JobDetailsHeader createdAt={job.createdAt} status={job.status} />
          <AccordionItemWrapper value="input" title={t("Input.title")}>
            <JobDetailsInputs rawInput={job.input} />
          </AccordionItemWrapper>
          <AccordionItemWrapper value="output" title={t("Output.title")}>
            <JobDetailsOutputs rawOutput={job.output} />
          </AccordionItemWrapper>
        </Accordion>
      </ScrollArea>
    </div>
  );
}

function JobDetailsHeader({
  createdAt,
  status,
}: {
  createdAt: Date;
  status: JobStatus;
}) {
  const formatter = useFormatter();
  return (
    <div className="bg-muted/50 flex items-center rounded-xl p-4">
      <div className="flex w-full items-center justify-between">
        <span>
          {formatter.dateTime(createdAt, {
            dateStyle: "full",
            timeStyle: "short",
          })}
        </span>
        <JobStatusBadge status={status} />
      </div>
    </div>
  );
}
