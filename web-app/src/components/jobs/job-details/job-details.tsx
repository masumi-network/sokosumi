import { useFormatter, useTranslations } from "next-intl";

import AccordionItemWrapper from "@/components/accordion-wrapper";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { Accordion } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobStatus, JobWithStatus } from "@/lib/db";
import { cn } from "@/lib/utils";

import JobDetailsInputs from "./inputs";
import JobDetailsName from "./job-details-name";
import JobDetailsOutputs from "./outputs";

interface JobDetailsProps {
  job: JobWithStatus;
  readOnly?: boolean;
  className?: string;
}

export default function JobDetails({
  job,
  readOnly = false,
  className,
}: JobDetailsProps) {
  const t = useTranslations("Components.Jobs.JobDetails");

  const hasCompletedOutput = job.status === JobStatus.COMPLETED && !!job.output;
  const defaultAccordionValue = hasCompletedOutput
    ? ["output"]
    : ["input", "output"];

  return (
    <div
      className={cn(
        "job-details-width flex h-full min-h-[300px] flex-1 flex-col",
        className,
      )}
    >
      <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
        <Accordion
          type="multiple"
          defaultValue={defaultAccordionValue}
          className="w-full space-y-1.5"
        >
          <JobDetailsHeader job={job} readOnly={readOnly} />
          <AccordionItemWrapper value="input" title={t("Input.title")}>
            <JobDetailsInputs
              rawInput={job.input}
              inputSchema={job.inputSchema}
              blobs={job.blobs}
            />
          </AccordionItemWrapper>
          <AccordionItemWrapper value="output" title={t("Output.title")}>
            <JobDetailsOutputs job={job} readOnly={readOnly} />
          </AccordionItemWrapper>
        </Accordion>
      </ScrollArea>
    </div>
  );
}

function JobDetailsHeader({
  job,
  readOnly,
}: {
  job: JobWithStatus;
  readOnly: boolean;
}) {
  const formatter = useFormatter();
  const { createdAt, status, isDemo } = job;

  return (
    <div className="flex flex-col gap-2">
      <JobDetailsName job={job} readOnly={readOnly} />
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl p-4">
        <p>
          {formatter.dateTime(createdAt, {
            dateStyle: "full",
            timeStyle: "short",
          })}
        </p>
        <JobStatusBadge status={status} isDemo={isDemo} />
      </div>
    </div>
  );
}
