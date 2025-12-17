"use client";

import {
  AgentJobStatus,
  JobEventWithRelations,
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

  const shouldCollapse = job.events.length > 2 && !showAllEvents;
  const collapsedCount = job.events.length - 2;

  const visibleEvents = shouldCollapse
    ? [job.events[0], job.events[job.events.length - 1]]
    : job.events;

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

        {visibleEvents.map((event: JobEventWithRelations, index) => (
          <div key={`${job.id}-event-${event.id}`}>
            <JobDetailsContent
              job={job}
              event={event}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
              isLast={index === visibleEvents.length - 1}
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
  event,
}: {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  return (
    <div
      className="mt-1.5 flex flex-col gap-2"
      key={`${job.id}-${event.status}-details-awaiting-input`}
    >
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl border p-4">
        <div className="flex flex-1 flex-col gap-4">
          <h3 className="font-semibold">{t("AwaitingInput.title")}</h3>
          <JobDetailsProvideInput job={job} event={event} />
        </div>
      </div>
    </div>
  );
}

function JobDetailsContent({
  job,
  event,
  readOnly,
  activeOrganizationId,
  isLast,
}: {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
  readOnly: boolean;
  activeOrganizationId?: string | null;
  isLast: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const outputBlobs = getOutputBlobs(event.blobs ?? []);
  const resultLinks = event.links ?? [];
  const hasSources = outputBlobs.length > 0 || resultLinks.length > 0;

  const isCompleted = event.status === AgentJobStatus.COMPLETED;
  const baseAccordion = isCompleted ? ["output"] : ["input", "output"];
  const defaultAccordionValue = hasSources
    ? [...baseAccordion, "sources"]
    : baseAccordion;

  const isAwaitingInput =
    event.status === AgentJobStatus.AWAITING_INPUT && event.input == null;

  return (
    <Accordion
      type="multiple"
      defaultValue={isLast ? defaultAccordionValue : []}
      className="w-full space-y-1.5"
    >
      <div className="flex flex-col gap-2 p-3 pt-4">
        <StatusDivider
          jobId={event.jobId}
          status={event.status}
          updatedAt={event.createdAt}
        />
      </div>
      {event.result ? (
        <AccordionItemWrapper
          value="output"
          title={isCompleted ? t("Output.result") : t("Output.status")}
          verificationBadge={
            isCompleted ? (
              <JobResultVerificationBadge
                direction="result"
                jobType={job.jobType}
                onChainStatus={job.purchase?.onChainStatus}
                identifierFromPurchaser={job.identifierFromPurchaser}
                result={event.result}
                resultHash={job.purchase?.resultHash}
              />
            ) : null
          }
        >
          <JobDetailsOutputs
            job={job}
            event={event}
            readOnly={readOnly}
            activeOrganizationId={activeOrganizationId}
          />
        </AccordionItemWrapper>
      ) : null}
      {hasSources ? (
        <AccordionItemWrapper value="sources" title={t("Sources.title")}>
          <JotOutputSources event={event} />
        </AccordionItemWrapper>
      ) : null}
      {event.input ? (
        <AccordionItemWrapper
          value="input"
          title={t("Input.title")}
          verificationBadge={
            <JobInputVerificationBadge
              direction="input"
              jobType={job.jobType}
              identifierFromPurchaser={job.identifierFromPurchaser}
              input={event.input.input}
              inputHash={event.input.inputHash}
            />
          }
        >
          <JobDetailsInputs
            input={event.input.input}
            inputSchema={event.inputSchema}
            blobs={getInputBlobs(event.blobs)}
            inputHash={event.input.inputHash}
            identifierFromPurchaser={job.identifierFromPurchaser}
            jobType={job.jobType}
          />
        </AccordionItemWrapper>
      ) : null}
      {isAwaitingInput ? (
        <JobDetailsProvideInputSection job={job} event={event} />
      ) : null}
    </Accordion>
  );
}
