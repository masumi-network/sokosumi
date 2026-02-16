"use client";

import {
  AgentJobStatus,
  JobEventWithRelations,
  JobWithSokosumiStatus,
} from "@sokosumi/database";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChannelProvider, useChannel } from "ably/react";
import { List, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import Header from "@/app/agents/[agentId]/jobs/components/header";
import { useJobsHeader } from "@/app/agents/[agentId]/jobs/components/jobs-header-context";
import { AgentIcon } from "@/components/agents/agent-icon";
import { AgentJobStatusBadge } from "@/components/jobs/agent-job-status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import DynamicAblyProvider from "@/contexts/alby-provider.dynamic";
import { jobStatusDataSchema, makeAgentJobsChannelName } from "@/lib/ably";
import { useSession } from "@/lib/auth/auth.client";
import { getAgentLegal, getAgentName } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";
import { formatTimeAgo } from "@/lib/utils/datetime";
import { getInitials } from "@/lib/utils/text";
import { getJobQueryKey, getJobQueryOptions } from "@/queries";

import JobDetailsInputs from "./inputs";
import {
  getVisibleTimelineEvents,
  shouldRenderAwaitingInputFormForViewer,
  splitInitiatedEvent,
} from "./job-details-events.utils";
import { JobDetailsFooter } from "./job-details-footer";
import JobDetailsName from "./job-details-name";
import { JobMetaDetails } from "./job-meta-details";
import JobDetailsOutputs from "./outputs";
import JobDetailsProvideInput from "./provide-input";
import JotOutputSources from "./sources";

const JOB_STATUS_EVENT_NAME = "job_status_data";

interface JobDetailsProps {
  job: JobWithSokosumiStatus;
  readOnly?: boolean;
  className?: string;
  activeOrganizationId?: string | null;
  showAgentHeader?: boolean;
}

export default function JobDetails({
  job: initialJob,
  readOnly = false,
  className,
  activeOrganizationId,
  showAgentHeader = true,
}: JobDetailsProps) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [showAllEvents, setShowAllEvents] = useState(false);
  const jobsHeader = useJobsHeader();

  const { data: job } = useQuery({
    ...getJobQueryOptions(initialJob.id, session),
    enabled: !!session,
    initialData: initialJob,
  });
  const { initiatedEvent, timelineEvents } = splitInitiatedEvent(job.events);
  const { collapsedCount, shouldCollapse, visibleEvents } =
    getVisibleTimelineEvents(timelineEvents, showAllEvents);

  const channelName = session?.user?.id
    ? makeAgentJobsChannelName(initialJob.agentId, session.user.id)
    : null;

  function handleStatusUpdate() {
    queryClient.invalidateQueries({
      queryKey: getJobQueryKey(initialJob.id),
    });
  }

  const detailsContent = (
    <div
      className={cn(
        "flex min-h-[300px] w-full flex-col gap-4 md:h-full",
        className,
      )}
    >
      <div className="flex w-full flex-col gap-4 md:h-full md:flex-row">
        <div className="flex w-full min-w-0 justify-center">
          <div className="max-w-4xl min-w-0 flex-1">
            {showAgentHeader && jobsHeader ? <Header {...jobsHeader} /> : null}
            <div className="space-y-8 pb-20">
              <JobDetailsHeader
                job={job}
                readOnly={readOnly}
                activeOrganizationId={activeOrganizationId}
              />

              <div className="md:hidden">
                <JobMetaDetails job={job} />
              </div>

              {initiatedEvent ? (
                <JobDetailsInitiatedSection job={job} event={initiatedEvent} />
              ) : null}

              <section className="space-y-4">
                <h2 className="text-muted-foreground/60 text-xs font-medium">
                  {t("activity")}
                </h2>

                {visibleEvents.length > 0 ? (
                  visibleEvents.map((event: JobEventWithRelations, index) => (
                    <div key={`${job.id}-event-${event.id}`}>
                      <JobDetailsContent
                        job={job}
                        event={event}
                        isLatestEvent={index === 0}
                        readOnly={readOnly}
                        activeOrganizationId={activeOrganizationId}
                      />
                      {shouldCollapse && index === 0 ? (
                        <CollapsedEventsButton
                          count={collapsedCount}
                          onExpand={() => setShowAllEvents(true)}
                        />
                      ) : null}
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground text-sm">
                    {t("emptyActivity")}
                  </p>
                )}
              </section>
            </div>
            <JobDetailsFooter legal={getAgentLegal(job.agent)} />
          </div>
        </div>

        <aside className="border-border hidden w-56 shrink-0 border-l md:block md:h-full">
          <div className="sticky top-20 pt-1 pr-2 pl-6">
            <JobMetaDetails job={job} />
          </div>
        </aside>
      </div>
    </div>
  );

  if (!channelName) {
    return detailsContent;
  }

  return (
    <DynamicAblyProvider>
      <ChannelProvider channelName={channelName}>
        <JobDetailsRealtimeListener
          channelName={channelName}
          jobId={initialJob.id}
          onStatusUpdate={handleStatusUpdate}
        />
        {detailsContent}
      </ChannelProvider>
    </DynamicAblyProvider>
  );
}

function JobDetailsRealtimeListener({
  channelName,
  jobId,
  onStatusUpdate,
}: {
  channelName: string;
  jobId: string;
  onStatusUpdate: () => void;
}) {
  useChannel(channelName, JOB_STATUS_EVENT_NAME, (message) => {
    const parsedResult = jobStatusDataSchema.safeParse(message.data);
    if (!parsedResult.success) {
      console.error("Failed to parse JobStatus from message", {
        channelName,
        messageName: message.name,
        messageData: message.data,
        error: parsedResult.error,
      });
      return;
    }

    if (parsedResult.data.jobId !== jobId) {
      return;
    }

    onStatusUpdate();
  });

  return null;
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

function JobDetailsInitiatedSection({
  job,
  event,
}: {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
}) {
  const t = useTranslations("Components.Jobs.JobDetails.InitiatedSection");

  return (
    <section className="space-y-4">
      <h2 className="text-muted-foreground/60 text-xs font-medium">
        {t("title")}
      </h2>
      <div>
        <JobDetailsInputs
          input={event.input?.input ?? null}
          inputSchema={event.inputSchema}
          attachments={event.input?.attachments ?? []}
          inputHash={event.input?.inputHash}
          identifierFromPurchaser={job.identifierFromPurchaser}
          jobType={job.jobType}
        />
      </div>
    </section>
  );
}

function JobDetailsContent({
  job,
  event,
  isLatestEvent,
  readOnly,
  activeOrganizationId,
}: {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
  isLatestEvent: boolean;
  readOnly: boolean;
  activeOrganizationId?: string | null;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const outputBlobs = event.blobs ?? [];
  const resultLinks = event.links ?? [];
  const hasSources = outputBlobs.length > 0 || resultLinks.length > 0;

  const isAwaitingInput = shouldRenderAwaitingInputFormForViewer(
    event,
    isLatestEvent,
    readOnly,
  );

  const isStatusOnlyEvent =
    !event.result && !event.input && !hasSources && !isAwaitingInput;
  const isCardEvent = !isStatusOnlyEvent;
  const actor = getJobEventActor({ job, event, isAwaitingInput });

  return (
    <div
      className={cn(
        "rounded-lg pr-3 pl-3",
        isCardEvent && "bg-muted/20 border-border/50 border",
      )}
    >
      <div className={cn("flex items-center gap-4", isCardEvent && "py-3")}>
        {isStatusOnlyEvent ? (
          <div className="flex size-6 shrink-0 items-center justify-center">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                getAgentJobStatusDotColorClass(event.status),
              )}
              aria-hidden
            />
          </div>
        ) : (
          <div className="bg-muted flex size-6 shrink-0 items-center justify-center self-start rounded-full">
            {actor.type === "user" ? (
              <Avatar className="size-6 shrink-0 self-start">
                {actor.imageUrl ? (
                  <AvatarImage src={actor.imageUrl} alt={actor.name} />
                ) : null}
                <AvatarFallback className="bg-muted text-[10px]">
                  {getInitials(actor.name)}
                </AvatarFallback>
              </Avatar>
            ) : (
              <AgentIcon agent={actor.agent} className="size-3.5" isMuted />
            )}
          </div>
        )}

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-row items-baseline justify-between gap-2">
            <div className="flex min-w-0 flex-wrap items-baseline gap-2 text-sm">
              <span className="truncate text-sm font-medium">{actor.name}</span>
              <span className="text-muted-foreground/60 text-xs">
                {t("actionUpdatedStatus")}
              </span>
              <AgentJobStatusBadge
                status={event.status}
                variant={isStatusOnlyEvent ? "text" : "dot"}
              />
            </div>
            <span className="text-muted-foreground/40 text-xs whitespace-nowrap">
              {formatTimeAgo(event.createdAt)}
            </span>
          </div>

          {isCardEvent ? (
            <div className="space-y-4 pt-1">
              {event.result ? (
                <section className="space-y-2">
                  <div className="flex items-center gap-2"></div>
                  <JobDetailsOutputs
                    job={job}
                    event={event}
                    readOnly={readOnly}
                    activeOrganizationId={activeOrganizationId}
                  />
                </section>
              ) : null}

              {hasSources ? (
                <section className="space-y-2">
                  <h3 className="text-muted-foreground/60 text-xs font-medium">
                    {t("Sources.title")}
                  </h3>
                  <JotOutputSources event={event} />
                </section>
              ) : null}

              {event.input ? (
                <section className="space-y-2">
                  <JobDetailsInputs
                    input={event.input.input}
                    inputSchema={event.inputSchema}
                    attachments={event.input.attachments ?? []}
                    inputHash={event.input.inputHash}
                    identifierFromPurchaser={job.identifierFromPurchaser}
                    jobType={job.jobType}
                  />
                </section>
              ) : null}

              {isAwaitingInput ? (
                <section className="space-y-2">
                  <h3 className="text-muted-foreground/60 text-xs font-medium">
                    {t("AwaitingInput.title")}
                  </h3>
                  <JobDetailsProvideInput job={job} event={event} />
                </section>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function getAgentJobStatusDotColorClass(status: AgentJobStatus) {
  switch (status) {
    case AgentJobStatus.COMPLETED:
      return "bg-green-500";
    case AgentJobStatus.FAILED:
      return "bg-red-500";
    case AgentJobStatus.AWAITING_INPUT:
      return "bg-yellow-500";
    case AgentJobStatus.AWAITING_PAYMENT:
      return "bg-orange-500";
    case AgentJobStatus.RUNNING:
    case AgentJobStatus.INITIATED:
      return "bg-sky-500";
    default:
      return "bg-gray-500";
  }
}

function getJobEventActor({
  job,
  event,
  isAwaitingInput,
}: {
  job: JobWithSokosumiStatus;
  event: JobEventWithRelations;
  isAwaitingInput: boolean;
}):
  | { type: "user"; name: string; imageUrl: string | null }
  | {
      type: "agent";
      name: string;
      agent: { name: string; icon: string | null };
    } {
  const agentName = getAgentName(job.agent);
  const agentActor = {
    type: "agent" as const,
    name: agentName,
    agent: {
      name: agentName,
      icon: job.agent.icon,
    },
  };

  if (isAwaitingInput || Boolean(event.input)) {
    // Show the user for input-required / input-provided events (fallback to agent).
    return job.user
      ? {
          type: "user",
          name: job.user.name,
          imageUrl: job.user.image ?? null,
        }
      : agentActor;
  }

  return agentActor;
}
