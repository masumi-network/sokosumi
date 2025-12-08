"use client";

import {
  JobEventWithStatus,
  JobStatus,
  JobWithEvent,
  JobWithStatus,
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
import { JobVerificationBadge } from "./job-verification-badge";
import JobDetailsOutputs from "./outputs";
import JobDetailsProvideInput from "./provide-input";
import JotOutputSources from "./sources";
import StatusDivider from "./status-divider";

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
  const { data: session } = useSession();
  const [showAllEvents, setShowAllEvents] = useState(false);

  const { data: job } = useQuery({
    ...getJobQueryOptions(initialJob.id, session),
    enabled: !!session,
    initialData: initialJob,
  });

  const filteredEvents =
    job.events.filter(
      (event: JobEventWithStatus) =>
        !(event.input == null && event.result == null),
    ) ?? [];

  const shouldCollapse = filteredEvents.length > 2 && !showAllEvents;
  const collapsedCount = filteredEvents.length - 2;

  const visibleEvents = shouldCollapse
    ? [filteredEvents[0], filteredEvents[filteredEvents.length - 1]]
    : filteredEvents;

  return (
    <div
      className={cn(
        "job-details-width flex h-full min-h-[300px] flex-1 flex-col",
        className,
      )}
    >
      <ScrollArea className="h-full [&_[data-slot=scroll-area-viewport]>div]:block!">
        <Accordion type="single" className="w-full space-y-1.5" collapsible>
          <AccordionItem value="job-details-header">
            <JobDetailsHeader
              job={job}
              readOnly={readOnly}
              activeOrganizationId={activeOrganizationId}
            />
          </AccordionItem>
        </Accordion>

        {visibleEvents.map((event: JobEventWithStatus, index) => (
          <div key={`${job.id}-event-${index}`}>
            <JobDetailsContent
              key={`${job.id}-event-${index}`}
              data={{ job, event }}
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
  job: JobWithStatus;
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

function JobDetailsProvideInputSection({ data }: { data: JobWithEvent }) {
  const _t = useTranslations("Components.Jobs.JobDetails");
  return (
    <div
      className="mt-1.5 flex flex-col gap-2"
      key={`${data.job.id}-${data.event.status}-details-awaiting-input`}
    >
      <div className="bg-muted/50 flex items-center justify-between gap-2 rounded-xl border p-4">
        <div className="flex flex-1 flex-col gap-4">
          {/* <h3 className="font-semibold">{t("AwaitingInput.title")}</h3> */}
          <JobDetailsProvideInput data={data} />
        </div>
      </div>
    </div>
  );
}

function JobDetailsContent({
  data,
  readOnly,
  activeOrganizationId,
  isLast,
}: {
  data: JobWithEvent;
  readOnly: boolean;
  activeOrganizationId?: string | null;
  isLast: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const inputBlobs = getInputBlobs(data.event.blobs ?? []);
  const outputBlobs = getOutputBlobs(data.event.blobs ?? []);
  const resultLinks = data.event.links ?? [];
  const hasSources = outputBlobs.length > 0 || resultLinks.length > 0;

  const hasCompletedOutput = data.event.status === JobStatus.COMPLETED;
  const baseAccordion = hasCompletedOutput ? ["output"] : ["input", "output"];
  const defaultAccordionValue = hasSources
    ? [...baseAccordion, "sources"]
    : baseAccordion;

  const isAwaitingInput =
    data.event.status === JobStatus.INPUT_REQUIRED && data.event.input === null;

  return (
    <Accordion
      type="multiple"
      defaultValue={isLast ? defaultAccordionValue : []}
      className="w-full space-y-1.5"
    >
      <div className="flex flex-col gap-2 p-3 pt-4">
        <StatusDivider data={data} />
      </div>
      {data.event.input ? (
        <AccordionItemWrapper
          value="input"
          title={t("Input.title")}
          verificationBadge={
            <JobVerificationBadge direction="input" data={data} />
          }
        >
          <JobDetailsInputs
            rawInput={data.event.input}
            rawInputSchema={data.event.inputSchema ?? null}
            blobs={inputBlobs}
            data={data}
          />
        </AccordionItemWrapper>
      ) : null}
      {data.event.result ? (
        <AccordionItemWrapper
          value="output"
          title={t("Output.title")}
          verificationBadge={
            data.job.completedAt != null ? (
              <JobVerificationBadge direction="result" data={data} />
            ) : null
          }
        >
          <JobDetailsOutputs
            data={data}
            readOnly={readOnly}
            activeOrganizationId={activeOrganizationId}
          />
        </AccordionItemWrapper>
      ) : null}
      {hasSources ? (
        <AccordionItemWrapper value="sources" title={t("Sources.title")}>
          <JotOutputSources job={data.job} />
        </AccordionItemWrapper>
      ) : null}
      {isAwaitingInput ? <JobDetailsProvideInputSection data={data} /> : null}
    </Accordion>
  );
}
