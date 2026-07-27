import { extractFileLikeLinks, extractHttpLinks } from "@sokosumi/utils";
import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useFormatter } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import {
  getTaskStatusBorderColorClass,
  getTaskStatusDotColorClass,
  TaskStatusBadge,
} from "@/app/tasks/components/task-status-badge";
import { getTaskEventChargePresentation } from "@/app/tasks/utils/task-event-charge-presentation";
import { buildTaskStatusLabels } from "@/app/tasks/utils/task-status-labels";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { JobStatusBadge } from "@/components/jobs/job-status-badge";
import { SourcesGrid } from "@/components/sources/sources-grid";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import {
  BlobStatus,
  Channel,
  type PublicSharedTask,
  SokosumiJobStatus,
  TaskStatus,
} from "@/lib/clients/generated/core";
import {
  CHANNEL_APP_NAME_KEY_MAP,
  CHANNEL_ICON_MAP,
} from "@/lib/constants/channel-icons";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { formatTimeAgo } from "@/lib/utils/datetime";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";
import { getInitials } from "@/lib/utils/text";
import { getFileNameFromUrl } from "@/lib/utils/url";

interface SharedTaskViewProps {
  task: PublicSharedTask;
}

function formatDate(date: Date, locale: string) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function getLinkedJobStatus(status: string): SokosumiJobStatus {
  return status as SokosumiJobStatus;
}

export async function SharedTaskView({ task }: SharedTaskViewProps) {
  const [locale, tTaskDetail, tTaskShare, tStatus] = await Promise.all([
    getLocale(),
    getTranslations("App.Tasks.Detail"),
    getTranslations("Share.Tasks.Page"),
    getTranslations("App.Tasks.Filters.statusOptions"),
  ]);
  const statusLabels = buildTaskStatusLabels((key) => tStatus(key));
  const visibleEvents = [...task.events]
    .filter((event) => event.status !== TaskStatus.AUTHENTICATION_REQUIRED)
    .sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  const latestStatusEventId =
    visibleEvents.find((event) => event.status)?.id ?? null;

  function TaskSharePropertiesPanel() {
    const formatter = useFormatter();
    const dateTimeOptions = {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    } as const;

    return (
      <div className="space-y-4">
        <h2 className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
          {tTaskDetail("properties")}
        </h2>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-sm">
              {tTaskDetail("status")}
            </span>
            <TaskStatusBadge
              status={task.status}
              label={statusLabels[task.status]}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-sm">
              {tTaskDetail("coworker")}
            </span>
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="size-6">
                {task.assignee?.image ? (
                  <AvatarImage
                    src={task.assignee.image}
                    alt={task.assignee.name}
                  />
                ) : null}
                <AvatarFallback className="text-[10px]">
                  {getInitials(task.assignee?.name ?? "C")}
                </AvatarFallback>
              </Avatar>
              <span className="truncate text-sm">
                {task.assignee?.name ?? "—"}
              </span>
            </div>
          </div>
          <div className="border-border/50 border-t pt-4">
            <div className="flex items-center justify-between gap-4">
              <span className="text-muted-foreground text-sm">
                {tTaskDetail("created")}
              </span>
              <span className="text-sm text-muted-foreground">
                {formatter.dateTime(task.createdAt, dateTimeOptions)}
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground text-sm">
              {tTaskDetail("updated")}
            </span>
            <span className="text-sm text-muted-foreground">
              {formatter.dateTime(task.updatedAt, dateTimeOptions)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[300px] w-full flex-col gap-4 md:h-full">
      <div className="flex w-full flex-col gap-4 md:h-full md:flex-row">
        <div className="flex w-full min-w-0 justify-center">
          <div className="min-w-0 flex-1 space-y-8 pb-20">
            <section className="space-y-4 pt-20 md:pt-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground text-xs font-medium tracking-[0.24em] uppercase">
                  {tTaskShare("eyebrow")}
                </span>
                <TaskStatusBadge
                  status={task.status}
                  label={statusLabels[task.status]}
                />
              </div>
              <h1 className="max-w-3xl text-3xl font-light tracking-tight md:text-4xl">
                {task.name}
              </h1>
              {task.description ? (
                <ExpandableMarkdown
                  content={task.description}
                  className="prose prose-sm max-w-none"
                  expandLabel={tTaskDetail("expand")}
                  collapseLabel={tTaskDetail("collapse")}
                />
              ) : (
                <p className="text-muted-foreground text-sm">
                  {tTaskShare("descriptionEmpty")}
                </p>
              )}
            </section>

            <div className="md:hidden">
              <TaskSharePropertiesPanel />
            </div>

            <div className="space-y-6">
              {task.jobs.length > 0 ? (
                <div>
                  <h2 className="text-muted-foreground mb-4 text-xs font-medium tracking-[0.24em] uppercase">
                    {tTaskDetail("jobs")}
                  </h2>
                  <ul className="space-y-3">
                    {task.jobs.map((job) => (
                      <li key={job.id} className="rounded-xl border p-4">
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="space-y-2">
                            <p className="text-sm font-medium">
                              {job.name?.trim() || tTaskDetail("jobsUntitled")}
                            </p>
                            <div className="text-muted-foreground flex flex-wrap items-center gap-3 text-xs">
                              <span>{job.agentName}</span>
                              <span>
                                {tTaskShare("jobCreatedAt", {
                                  date: formatDate(job.createdAt, locale),
                                })}
                              </span>
                              {job.completedAt ? (
                                <span>
                                  {tTaskShare("jobCompletedAt", {
                                    date: formatDate(job.completedAt, locale),
                                  })}
                                </span>
                              ) : null}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-3">
                            <JobStatusBadge
                              status={getLinkedJobStatus(job.status)}
                            />
                            {job.shareToken ? (
                              <Link
                                href={`/share/${job.shareToken}`}
                                className="text-sm underline-offset-4 hover:underline"
                              >
                                <span className="inline-flex items-center gap-1">
                                  {tTaskShare("publicJobLink")}
                                  <ArrowUpRight className="size-3" />
                                </span>
                              </Link>
                            ) : (
                              <span className="text-muted-foreground text-xs">
                                {tTaskShare("privateJobLink")}
                              </span>
                            )}
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <section className="space-y-4">
                <h2 className="text-muted-foreground/60 text-xs font-medium">
                  {tTaskDetail("activity")}
                </h2>
                {visibleEvents.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    {tTaskDetail("emptyActivity")}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {visibleEvents.map((event) => {
                      const channel = event.channel as Channel;
                      const channelAppName = tTaskDetail(
                        `channelApp.${CHANNEL_APP_NAME_KEY_MAP[channel]}`,
                      );
                      const originFromLabel = tTaskDetail("originFromApp", {
                        appName: channelAppName,
                      });
                      const ChannelIcon = CHANNEL_ICON_MAP[channel];
                      const actorName =
                        event.actorName ?? tTaskDetail("actorSystem");
                      const chargePresentation =
                        getTaskEventChargePresentation(event);
                      const chargedLabel = chargePresentation.hasCharge
                        ? tTaskDetail(
                            chargePresentation.isAttemptedCharge
                              ? "actionTriedChargedCredits"
                              : "actionChargedCredits",
                            {
                              credits: formatCreditsForDisplay(
                                event.credits ?? 0,
                              ),
                            },
                          )
                        : null;
                      const action =
                        chargePresentation.actionKind === "commented"
                          ? tTaskDetail("actionCommented")
                          : chargePresentation.actionKind === "charged"
                            ? (chargedLabel ??
                              tTaskDetail("actionUpdatedStatus"))
                            : tTaskDetail("actionUpdatedStatus");
                      const formattedComment = chargePresentation.hasComment
                        ? formatMentionsAsMarkdownLinks(
                            event.comment ?? "",
                            new Map(),
                          )
                        : null;
                      const sourceFiles = formattedComment
                        ? extractFileLikeLinks(formattedComment).map(
                            (url, fileIndex) => ({
                              id: `${event.id}-file-${fileIndex}`,
                              sourceUrl: url,
                              fileUrl: url,
                              name: getFileNameFromUrl(url),
                              status: BlobStatus.READY,
                            }),
                          )
                        : [];
                      const sourceLinks = formattedComment
                        ? extractHttpLinks(formattedComment).map(
                            (url, linkIndex) => ({
                              id: `${event.id}-link-${linkIndex}`,
                              url,
                            }),
                          )
                        : [];
                      const hasCommentSources =
                        sourceFiles.length > 0 || sourceLinks.length > 0;
                      const isCommentEvent = Boolean(formattedComment);
                      const shouldShowSecondaryChargeLine =
                        chargePresentation.shouldShowSecondaryChargeLine;
                      const shouldHighlightDoneBorder =
                        isCommentEvent && event.status === TaskStatus.COMPLETED;
                      const isStatusOnlyEvent =
                        !isCommentEvent && Boolean(event.status);
                      const isLatestStatusEvent =
                        Boolean(event.status) &&
                        event.id === latestStatusEventId;

                      return (
                        <div
                          key={event.id}
                          data-testid={`activity-row-${event.id}`}
                          className={cn(
                            "rounded-lg pr-3 pl-3",
                            isCommentEvent &&
                              "bg-muted/20 border-border/50 border",
                            shouldHighlightDoneBorder &&
                              getTaskStatusBorderColorClass(
                                TaskStatus.COMPLETED,
                              ),
                          )}
                        >
                          <div
                            className={cn(
                              "flex items-center gap-4",
                              isCommentEvent && "py-3",
                            )}
                          >
                            {isStatusOnlyEvent && event.status ? (
                              <div className="flex size-6 shrink-0 items-center justify-center">
                                <span
                                  data-testid={`status-dot-${event.id}`}
                                  className={cn(
                                    "size-1.5 shrink-0 rounded-full",
                                    getTaskStatusDotColorClass(event.status),
                                  )}
                                  aria-hidden
                                />
                              </div>
                            ) : (
                              <Avatar className="size-6 shrink-0 self-start">
                                {event.actorImage ? (
                                  <AvatarImage
                                    src={event.actorImage}
                                    alt={actorName}
                                  />
                                ) : null}
                                <AvatarFallback className="bg-muted text-[10px]">
                                  {getInitials(actorName)}
                                </AvatarFallback>
                              </Avatar>
                            )}
                            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                              <div className="flex flex-row items-baseline justify-between gap-2">
                                <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
                                  <span className="text-sm font-medium">
                                    {actorName}
                                  </span>
                                  <span className="text-muted-foreground/60 inline-flex items-center gap-1 text-xs">
                                    <span>{action}</span>
                                    {!event.status ? (
                                      <>
                                        <span>{originFromLabel}</span>
                                        <ChannelIcon
                                          className="text-muted-foreground/50 size-3.5 shrink-0"
                                          role="img"
                                          aria-label={originFromLabel}
                                          data-testid={`origin-icon-${event.id}`}
                                        />
                                      </>
                                    ) : null}
                                  </span>
                                  {event.status ? (
                                    <>
                                      <TaskStatusBadge
                                        status={event.status}
                                        label={statusLabels[event.status]}
                                        showDot={
                                          isLatestStatusEvent &&
                                          !isStatusOnlyEvent
                                        }
                                      />
                                      <span className="text-muted-foreground/60 inline-flex items-center gap-1 text-xs">
                                        <span>{originFromLabel}</span>
                                        <ChannelIcon
                                          className="text-muted-foreground/50 size-3.5 shrink-0"
                                          role="img"
                                          aria-label={originFromLabel}
                                          data-testid={`origin-icon-${event.id}`}
                                        />
                                      </span>
                                    </>
                                  ) : null}
                                </div>
                                <span className="text-muted-foreground/40 text-xs whitespace-nowrap">
                                  {formatTimeAgo(event.createdAt, locale)}
                                </span>
                              </div>
                              {formattedComment ? (
                                <ExpandableMarkdown
                                  content={formattedComment}
                                  className="prose-sm text-foreground/70 text-sm"
                                  expandLabel={tTaskDetail("expand")}
                                  collapseLabel={tTaskDetail("collapse")}
                                  fadeClassName="to-transparent"
                                />
                              ) : null}
                              {hasCommentSources ? (
                                <div className="space-y-1.5">
                                  <Separator className="my-3" />
                                  {sourceFiles.length > 0 ? (
                                    <SourcesGrid
                                      title={tTaskDetail("sourcesFiles")}
                                      blobs={sourceFiles}
                                      className="mt-0"
                                    />
                                  ) : null}
                                  {sourceLinks.length > 0 ? (
                                    <SourcesGrid
                                      title={tTaskDetail("sourcesLinks")}
                                      links={sourceLinks}
                                      className="mt-0"
                                    />
                                  ) : null}
                                </div>
                              ) : null}
                              {shouldShowSecondaryChargeLine ? (
                                <div className="text-muted-foreground/60 text-xs">
                                  {chargedLabel}
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>

        <aside className="border-border hidden w-56 shrink-0 border-l md:block md:min-h-[calc(100svh-64px)]">
          <div className="sticky top-20 pt-1 pr-2 pl-6">
            <TaskSharePropertiesPanel />
          </div>
        </aside>
      </div>
    </div>
  );
}
