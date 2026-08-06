"use client";

import { ArrowLeftRight, List, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import Header from "@/app/agents/[agentId]/jobs/components/header";
import { useJobsHeader } from "@/app/agents/[agentId]/jobs/components/jobs-header-context";
import { getWorkspaceMoveTargetCount } from "@/app/tasks/components/workspace-move-targets";
import { AgentIcon } from "@/components/agents/agent-icon";
import {
  AgentJobStatusBadge,
  getAgentStatusBorderColorClass,
  getAgentStatusDotColorClass,
} from "@/components/jobs/agent-job-status-badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Job, MemberWithOrganization } from "@/lib/clients/generated/core";
import { getAgentLegal, getAgentName } from "@/lib/helpers/agent";
import { cn } from "@/lib/utils";
import { useLocalizedDateTime } from "@/lib/utils/datetime.client";
import { getInitials } from "@/lib/utils/text";
import { JobStatusBadge } from "../job-status-badge";
import JobDetailsInputs from "./inputs";
import {
  getVisibleTimelineEvents,
  type JobEvent,
  shouldHighlightJobEventBorder,
  shouldRenderAwaitingInputFormForViewer,
  splitInitiatedEvent,
} from "./job-details-events.utils";
import { JobDetailsFooter } from "./job-details-footer";
import JobDetailsName, {
  useJobDetailsNameController,
} from "./job-details-name";
import { JobMetaDetails } from "./job-meta-details";
import JobShareButton from "./job-share-button";
import { MoveJobToWorkspaceDialog } from "./move-job-to-workspace-dialog";
import JobDetailsOutputs from "./outputs";
import JobDetailsProvideInput from "./provide-input";
import JotOutputSources from "./sources";

export interface JobDetailsViewProps {
  job: Job;
  readOnly?: boolean;
  className?: string;
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel?: string;
  projectName?: string | null;
  showAgentHeader?: boolean;
  /** Share route only: eyebrow, status badge, agent title, mobile top offset. */
  publicJobLayout?: boolean;
}

export default function JobDetailsView({
  job,
  readOnly = false,
  className,
  organizations,
  personalWorkspaceLabel,
  projectName,
  showAgentHeader = true,
  publicJobLayout = false,
}: JobDetailsViewProps) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const [showAllEvents, setShowAllEvents] = useState(false);
  const jobsHeader = useJobsHeader();
  const nameController = useJobDetailsNameController(job);

  const { initiatedEvent, timelineEvents } = splitInitiatedEvent(job.events);
  const { collapsedCount, shouldCollapse, visibleEvents } =
    getVisibleTimelineEvents(timelineEvents, showAllEvents);

  const agentName = getAgentName(job.agent);

  return (
    <div
      className={cn(
        "flex min-h-[300px] w-full flex-col gap-4 md:h-full",
        className,
      )}
    >
      <div className="flex w-full flex-col gap-4 md:h-full md:flex-row">
        <div className="flex w-full min-w-0 justify-center">
          <div
            className={cn(
              "min-w-0 flex-1 space-y-4 max-w-4xl",
              publicJobLayout && "pt-20 md:pt-4 max-w-none",
            )}
          >
            {publicJobLayout ? (
              <>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
                    {t("eyebrow")}
                  </span>
                  <JobStatusBadge status={job.status} />
                </div>
                <h1 className="max-w-3xl text-3xl font-light tracking-tight md:text-4xl">
                  {agentName}
                </h1>
              </>
            ) : null}
            {showAgentHeader && jobsHeader ? (
              <Header
                {...jobsHeader}
                detailActions={
                  !readOnly ? (
                    <JobDetailsTopBarActions
                      job={job}
                      editing={nameController.editing}
                      onEdit={nameController.startEditing}
                      organizations={organizations}
                      personalWorkspaceLabel={personalWorkspaceLabel}
                    />
                  ) : undefined
                }
              />
            ) : null}
            <div className="space-y-8 pb-20">
              <JobDetailsHeader
                job={job}
                organizations={organizations}
                personalWorkspaceLabel={personalWorkspaceLabel}
                readOnly={readOnly}
                showInlineActions={!showAgentHeader}
                controller={nameController}
              />

              <div className="md:hidden">
                <JobMetaDetails job={job} projectName={projectName} />
              </div>

              {initiatedEvent ? (
                <JobDetailsInitiatedSection job={job} event={initiatedEvent} />
              ) : null}

              <section className="space-y-4">
                <h2 className="text-muted-foreground/60 text-xs font-medium">
                  {t("activity")}
                </h2>

                {visibleEvents.length > 0 ? (
                  visibleEvents.map((event: JobEvent, index) => (
                    <div key={`${job.id}-event-${event.id}`}>
                      <JobDetailsContent
                        job={job}
                        event={event}
                        isLatestEvent={index === 0}
                        readOnly={readOnly}
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

        <aside className="border-border hidden w-56 shrink-0 border-l md:block md:min-h-[calc(100svh-4rem)]">
          <div className="sticky top-20 pt-1 pr-2 pl-6">
            <JobMetaDetails job={job} projectName={projectName} />
          </div>
        </aside>
      </div>
    </div>
  );
}

function JobDetailsHeader({
  job,
  organizations,
  personalWorkspaceLabel,
  readOnly,
  showInlineActions,
  controller,
}: {
  job: Job;
  organizations?: MemberWithOrganization[];
  personalWorkspaceLabel?: string;
  readOnly: boolean;
  showInlineActions: boolean;
  controller: ReturnType<typeof useJobDetailsNameController>;
}) {
  return (
    <div className="flex flex-col gap-2" key={`${job.id}-details-header`}>
      {!readOnly && showInlineActions ? (
        <div className="flex justify-end">
          <JobDetailsTopBarActions
            job={job}
            editing={controller.editing}
            onEdit={controller.startEditing}
            organizations={organizations}
            personalWorkspaceLabel={personalWorkspaceLabel}
          />
        </div>
      ) : null}
      <JobDetailsName
        editing={controller.editing}
        name={job.name ?? null}
        form={controller.form}
        handleSubmit={controller.submit}
        handleCancel={controller.cancelEditing}
      />
    </div>
  );
}

function JobDetailsTopBarActions({
  job,
  editing,
  organizations,
  onEdit,
  personalWorkspaceLabel,
}: {
  job: Job;
  editing: boolean;
  organizations?: MemberWithOrganization[];
  onEdit: () => void;
  personalWorkspaceLabel?: string;
}) {
  const tName = useTranslations("Components.Jobs.JobDetails.Header.JobName");
  const tActions = useTranslations("Components.Jobs.JobDetails.Header.Actions");
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const currentOrganizationId = job.workspace.organizationId ?? null;
  const moveTargetCount = getWorkspaceMoveTargetCount(
    currentOrganizationId,
    organizations,
  );
  const canMoveStandaloneJob =
    !job.taskId && moveTargetCount > 0 && !!personalWorkspaceLabel;
  const isTaskControlledJob = !!job.taskId;

  return (
    <>
      <div className="flex items-center gap-1.5">
        {canMoveStandaloneJob ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 md:size-7"
            onClick={() => setIsMoveOpen(true)}
            title={tActions("moveToWorkspace")}
            aria-label={tActions("moveToWorkspace")}
          >
            <ArrowLeftRight className="size-4" />
          </Button>
        ) : null}
        {isTaskControlledJob ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-8 md:size-7"
                  title={tActions("moveToWorkspace")}
                  aria-label={tActions("moveToWorkspace")}
                  disabled
                >
                  <ArrowLeftRight className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {tActions("moveToWorkspaceDisabledTooltip")}
            </TooltipContent>
          </Tooltip>
        ) : null}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 md:size-7"
          onClick={onEdit}
          title={tName("edit")}
          aria-label={tName("edit")}
          disabled={editing}
        >
          <Pencil className="size-4" />
        </Button>
        <JobShareButton
          job={job}
          variant="ghost"
          size="icon"
          className="size-8 text-foreground md:size-7"
        />
      </div>
      {canMoveStandaloneJob && personalWorkspaceLabel ? (
        <MoveJobToWorkspaceDialog
          agentId={job.agentId}
          currentOrganizationId={currentOrganizationId}
          jobId={job.id}
          onOpenChange={setIsMoveOpen}
          open={isMoveOpen}
          organizations={organizations ?? []}
          personalWorkspaceLabel={personalWorkspaceLabel}
        />
      ) : null}
    </>
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
  job: Job;
  event: JobEvent;
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
          inputSchema={event.inputSchema ?? null}
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
}: {
  job: Job;
  event: JobEvent;
  isLatestEvent: boolean;
  readOnly: boolean;
}) {
  const t = useTranslations("Components.Jobs.JobDetails");
  const { formatTimeAgo } = useLocalizedDateTime();
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
  const shouldHighlightBorder = shouldHighlightJobEventBorder(
    event,
    isLatestEvent,
  );
  const actor = getJobEventActor({ job, event });

  return (
    <div
      className={cn(
        "rounded-lg pr-3 pl-3",
        isCardEvent && "bg-muted/20 border-border/50 border",
        isCardEvent &&
          shouldHighlightBorder &&
          getAgentStatusBorderColorClass(event.status),
      )}
    >
      <div className={cn("flex items-center gap-4", isCardEvent && "py-3")}>
        {isStatusOnlyEvent ? (
          <div className="flex size-6 shrink-0 items-center justify-center">
            <span
              className={cn(
                "size-1.5 shrink-0 rounded-full",
                getAgentStatusDotColorClass(event.status),
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
                <AvatarFallback className="bg-muted text-[0.625rem]">
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
                  <JobDetailsOutputs
                    job={job}
                    event={event}
                    readOnly={readOnly}
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
                    inputSchema={event.inputSchema ?? null}
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

function getJobEventActor({ job, event }: { job: Job; event: JobEvent }):
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
      icon: job.agent.icon ?? null,
    },
  };

  if (event.input) {
    // Show the user for input-provided events (fallback to agent).
    return job.owner
      ? {
          type: "user",
          name: job.owner.name,
          imageUrl: job.owner.image ?? null,
        }
      : agentActor;
  }

  return agentActor;
}
