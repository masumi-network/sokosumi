"use client";

import { JobWithStatus, SokosumiJobStatus } from "@sokosumi/database";
import { useQuery } from "@tanstack/react-query";
import { useFormatter, useTranslations } from "next-intl";

import AccordionItemWrapper from "@/components/accordion-wrapper";
import { JobStatusBadge } from "@/components/jobs";
import { Accordion } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import {
  getInputBlobs,
  getOutputBlobs,
  getResultLinks,
} from "@/lib/utils/job-transformers";
import { getJobQueryOptions } from "@/queries";

import JobDetailsInputs from "./inputs";
import JobDetailsName from "./job-details-name";
import { JobVerificationBadge } from "./job-verification-badge";
import JobDetailsOutputs from "./outputs";
import JotOutputSources from "./sources";

interface JobDetailsProps {
  job: JobWithStatus;
  readOnly?: boolean;
  className?: string;
  activeOrganizationId?: string | null;
}

export default function JobDetails({
  job: initialJob,
  readOnly = false,
  className,
  activeOrganizationId,
}: JobDetailsProps) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const { data: session } = useSession();

  const { data: job } = useQuery({
    ...getJobQueryOptions(initialJob.id, session),
    enabled: !!session,
    initialData: initialJob,
  });

  const rawInput = job.input;
  const rawInputSchema = job.inputSchema;

  const hasCompletedOutput =
    job.status === SokosumiJobStatus.COMPLETED && !!job.result;
  // Get blobs separated by origin (INPUT and OUTPUT) from all events
  const inputBlobs = getInputBlobs(job);
  const outputBlobs = getOutputBlobs(job);
  const resultLinks = getResultLinks(job);
  const hasSources = outputBlobs.length > 0 || resultLinks.length > 0;
  const baseAccordion = hasCompletedOutput ? ["output"] : ["input", "output"];
  const defaultAccordionValue = hasSources
    ? [...baseAccordion, "sources"]
    : baseAccordion;

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
          <JobDetailsHeader
            job={job}
            readOnly={readOnly}
            activeOrganizationId={activeOrganizationId}
          />
          <AccordionItemWrapper
            value="input"
            title={t("Input.title")}
            verificationBadge={
              <JobVerificationBadge direction="input" job={job} />
            }
          >
            <JobDetailsInputs
              rawInput={rawInput}
              rawInputSchema={rawInputSchema}
              blobs={inputBlobs}
            />
          </AccordionItemWrapper>
          <AccordionItemWrapper
            value="output"
            title={t("Output.title")}
            verificationBadge={
              job.completedAt != null ? (
                <JobVerificationBadge direction="result" job={job} />
              ) : null
            }
          >
            <JobDetailsOutputs
              job={job}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
            />
          </AccordionItemWrapper>
          {hasSources ? (
            <AccordionItemWrapper value="sources" title={t("Sources.title")}>
              <JotOutputSources job={job} />
            </AccordionItemWrapper>
          ) : null}
        </Accordion>
      </ScrollArea>
    </div>
  );
}

function JobDetailsHeader({
  job,
  readOnly,
  activeOrganizationId,
}: {
  job: JobWithStatus;
  readOnly: boolean;
  activeOrganizationId?: string | null;
}) {
  const formatter = useFormatter();
  const { createdAt, status, jobType } = job;

  return (
    <div
      className="flex flex-col gap-2"
      key={`${job.id}-${status}-details-header`}
    >
      <JobDetailsName
        job={job}
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl border p-4">
        <p>
          {formatter.dateTime(createdAt, {
            dateStyle: "full",
            timeStyle: "short",
          })}
        </p>
        <JobStatusBadge
          key={`${job.id}-${status}-details-badge`}
          status={status}
          jobType={jobType}
        />
      </div>
    </div>
  );
}
