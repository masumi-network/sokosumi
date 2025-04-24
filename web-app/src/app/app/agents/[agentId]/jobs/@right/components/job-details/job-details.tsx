import { useFormatter, useTranslations } from "next-intl";

import AccordionItemWrapper from "@/app/agents/[agentId]/jobs/@right/components/accordion-wrapper";
import JobStatusBadge from "@/app/agents/[agentId]/jobs/components/job-status-badge";
import { Accordion } from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { JobWithRelations } from "@/lib/db";
import { cn } from "@/lib/utils";
import { JobStatus } from "@/prisma/generated/client";

import JobDetailsInputs from "./inputs";
import JobDetailsOutputs from "./outputs";

interface JobDetailsProps {
  job: JobWithRelations;
  className?: string | undefined;
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
  const t = useTranslations("App.Agents.Jobs.JobDetails.Header");
  const formatter = useFormatter();

  return (
    <div className="bg-muted/50 flex items-center rounded-xl p-4">
      <div className="flex items-center gap-1.5">
        <p>
          {formatter.dateTime(createdAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </p>
        <Badge variant="secondary">{t("input")}</Badge>
      </div>
      <div className="flex-1 text-center">
        <JobStatusBadge status={status} />
      </div>
    </div>
  );
}
