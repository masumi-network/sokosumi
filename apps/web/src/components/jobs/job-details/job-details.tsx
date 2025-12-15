"use client";

import {
  AgentJobStatus,
  JobStatusWithRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import { useQuery } from "@tanstack/react-query";
import { List, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import AccordionItemWrapper from "@/components/accordion-wrapper";
import { Accordion, AccordionItem } from "@/components/ui/accordion";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useSession } from "@/lib/auth/auth.client";
import { cn } from "@/lib/utils";
import { getInputBlobs, getOutputBlobs } from "@/lib/utils/job-transformers";
import { getJobQueryOptions } from "@/queries";

import JobDetailsInputs from "./inputs";
import JobDetailsName from "./job-details-name";
import {
  JobInputVerificationBadge,
  JobResultVerificationBadge,
} from "./job-verification-badge";
import JobDetailsOutputs from "./outputs";
import JobDetailsProvideInput from "./provide-input";
import JotOutputSources from "./sources";
import StatusDivider from "./status-divider";

interface JobDetailsProps {
  job: JobWithSokosumiStatus;
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
  const { data: session } = useSession();
  const [showAllEvents, setShowAllEvents] = useState(false);

  const { data: job } = useQuery({
    ...getJobQueryOptions(initialJob.id, session),
    enabled: !!session,
    initialData: initialJob,
  });

  const shouldCollapse = job.statuses.length > 2 && !showAllEvents;
  const collapsedCount = job.statuses.length - 2;

  const visibleStatuses = shouldCollapse
    ? [job.statuses[0], job.statuses[job.statuses.length - 1]]
    : job.statuses;

  return (
    <div
      className={cn(
        "job-details-width flex h-full min-h-[300px] flex-1 flex-col",
        className,
      )}
    >
      <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
        <Accordion type="multiple" className="w-full space-y-1.5">
          <AccordionItem value="job-details-header" className="border-0">
            <JobDetailsHeader
              job={job}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
            />
          </AccordionItem>
        </Accordion>

        {visibleStatuses.map((status: JobStatusWithRelations, index) => (
          <div key={`${job.id}-event-${status.id}`}>
            <JobDetailsContent
              job={job}
              status={status}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
              isLast={index === visibleStatuses.length - 1}
            />
            {shouldCollapse && index === 0 && (
              <CollapsedEventsButton
                count={collapsedCount}
                onExpand={() => setShowAllEvents(true)}
              />
            )}
          </div>
        ))}
      </ScrollArea>
    </div>
  );
}

function JobDetailsHeader({
  job,
  readOnly,
  activeOrganizationId,
}: {
  job: JobWithSokosumiStatus;
  readOnly: boolean;
  activeOrganizationId?: string | null;
}) {
  return (
    <div className="flex flex-col gap-2" key={`${job.id}-details-header`}>
      <JobDetailsName
        job={job}
        readOnly={readOnly}
        activeOrganizationId={activeOrganizationId}
      />
    </div>
  );
}

function CollapsedEventsButton({
  count,
  onExpand,
}: {
  count: number;
  onExpand: () => void;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");

  return (
    <button
      type="button"
      onClick={onExpand}
      className="text-muted-foreground hover:text-muted-foreground/50 mx-3 my-4 flex w-[calc(100%-1.5rem)] cursor-pointer items-center justify-between gap-2 py-4 pb-2 transition-colors hover:underline"
    >
      <div className="flex shrink-0 items-center gap-2">
        <List className="size-4" />
        <span className="text-sm">
          {t("CollapsedEvents.seeMore", { count })}
        </span>
      </div>
      <hr className="w-full" />
      <Plus className="size-4" />
    </button>
  );
}

function JobDetailsProvideInputSection({
  job,
  status,
}: {
  job: JobWithSokosumiStatus;
  status: JobStatusWithRelations;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  return (
    <div
      className="mt-1.5 flex flex-col gap-2"
      key={`${job.id}-${status.status}-details-awaiting-input`}
    >
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl border p-4">
        <div className="flex flex-1 flex-col gap-4">
          <h3 className="font-semibold">{t("AwaitingInput.title")}</h3>
          <JobDetailsProvideInput job={job} status={status} />
        </div>
      </div>
    </div>
  );
}

function JobDetailsContent({
  job,
  status,
  readOnly,
  activeOrganizationId,
  isLast,
}: {
  job: JobWithSokosumiStatus;
  status: JobStatusWithRelations;
  readOnly: boolean;
  activeOrganizationId?: string | null;
  isLast: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const outputBlobs = getOutputBlobs(status.blobs ?? []);
  const resultLinks = status.links ?? [];
  const hasSources = outputBlobs.length > 0 || resultLinks.length > 0;

  const isCompleted = status.status === AgentJobStatus.COMPLETED;
  const baseAccordion = isCompleted ? ["output"] : ["input", "output"];
  const defaultAccordionValue = hasSources
    ? [...baseAccordion, "sources"]
    : baseAccordion;

  const isAwaitingInput =
    status.status === AgentJobStatus.AWAITING_INPUT && status.input == null;

  return (
    <Accordion
      type="multiple"
      defaultValue={isLast ? defaultAccordionValue : []}
      className="w-full space-y-1.5"
    >
      <div className="flex flex-col gap-2 p-3 pt-4">
        <StatusDivider
          jobId={status.jobId}
          status={status.status}
          updatedAt={status.createdAt}
        />
      </div>
      {status.input ? (
        <AccordionItemWrapper
          value="input"
          title={t("Input.title")}
          verificationBadge={
            <JobInputVerificationBadge
              direction="input"
              jobType={job.jobType}
              identifierFromPurchaser={job.identifierFromPurchaser}
              input={status.input.input}
              inputHash={status.input.inputHash}
            />
          }
        >
          <JobDetailsInputs
            input={status.input.input}
            inputSchema={status.inputSchema}
            blobs={getInputBlobs(status.blobs)}
            inputHash={status.input.inputHash}
            identifierFromPurchaser={job.identifierFromPurchaser}
            jobType={job.jobType}
          />
        </AccordionItemWrapper>
      ) : null}
      {status.result ? (
        <AccordionItemWrapper
          value="output"
          title={isCompleted ? t("Output.result") : t("Output.message")}
          verificationBadge={
            isCompleted ? (
              <JobResultVerificationBadge
                direction="result"
                jobType={job.jobType}
                onChainStatus={job.purchase?.onChainStatus}
                identifierFromPurchaser={job.identifierFromPurchaser}
                result={status.result}
                resultHash={job.purchase?.resultHash}
              />
            ) : null
          }
        >
          <JobDetailsOutputs
            job={job}
            status={status}
            readOnly={readOnly}
            activeOrganizationId={activeOrganizationId}
          />
        </AccordionItemWrapper>
      ) : null}
      {hasSources ? (
        <AccordionItemWrapper value="sources" title={t("Sources.title")}>
          <JotOutputSources status={status} />
        </AccordionItemWrapper>
      ) : null}
      {isAwaitingInput ? (
        <JobDetailsProvideInputSection job={job} status={status} />
      ) : null}
    </Accordion>
  );
}
