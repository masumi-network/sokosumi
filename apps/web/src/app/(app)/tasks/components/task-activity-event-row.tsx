"use client";

import {
  extractFileLikeLinks,
  extractHttpLinks,
  type SubscriptionPlanName,
} from "@sokosumi/utils";
import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  getEventActorInfo,
  resolveTaskEventActorKind,
  type TaskActivityActorInfo,
} from "@/app/tasks/utils/task-activity-actors";
import { isLatestMatchingStatusEvent } from "@/app/tasks/utils/task-activity-feed";
import { getTaskEventChargePresentation } from "@/app/tasks/utils/task-event-charge-presentation";
import { AssistantOrb } from "@/components/aurora-orb";
import { ExpandableMarkdown } from "@/components/expandable-markdown";
import { SourcesGrid } from "@/components/sources/sources-grid";
import { TimeAgo } from "@/components/time-ago";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BlobStatus, TaskStatus } from "@/lib/clients/generated/core";
import type {
  TaskEvent,
  TaskFile,
} from "@/lib/clients/generated/core/types.gen";
import {
  CHANNEL_APP_NAME_KEY_MAP,
  CHANNEL_ICON_MAP,
} from "@/lib/constants/channel-icons";
import { cn } from "@/lib/utils";
import { formatCreditsForDisplay } from "@/lib/utils/credits";
import { formatMentionsAsMarkdownLinks } from "@/lib/utils/mention-parser";
import { getInitials } from "@/lib/utils/text";
import { getFileNameFromUrl } from "@/lib/utils/url";
import {
  getTaskStatusBorderColorClass,
  getTaskStatusDotColorClass,
  TaskStatusInline,
} from "./task-status-badge";

/** Everything a row reads from the section, resolved once per render. */
export interface TaskActivityRowContext {
  actorCoworkerLabel: string;
  actorUserLabel: string;
  actorSokoBotLabel: string;
  actorSystemLabel: string;
  actionCommentedLabel: string;
  actionUpdatedStatusLabel: string;
  expandLabel: string;
  collapseLabel: string;
  latestEventId: string | null;
  taskFiles: TaskFile[];
  agentNameById: Map<string, string>;
  mentionUserNameById: Map<string, string>;
  userById?: Record<string, TaskActivityActorInfo>;
  coworkerById?: Record<string, TaskActivityActorInfo>;
  sokoBotById?: Record<string, TaskActivityActorInfo>;
  viewerPlan: SubscriptionPlanName | null;
}

/**
 * Match a comment file URL to a TaskFile. Prefers exact sourceUrl (keeps ?token=),
 * then fileUrl, then pathname basename === name (only when exactly one file matches).
 */
function matchTaskFile(
  url: string,
  taskFiles: TaskFile[],
): TaskFile | undefined {
  // Try exact sourceUrl match first
  for (const file of taskFiles) {
    if (file.sourceUrl === url) {
      return file;
    }
  }
  // Try fileUrl match
  for (const file of taskFiles) {
    if (file.fileUrl === url) {
      return file;
    }
  }
  // Try pathname basename match (only if unique)
  const urlBasename = url.split("/").pop()?.split("?")[0];
  if (urlBasename) {
    const basenameMatches: TaskFile[] = [];
    for (const file of taskFiles) {
      if (file.name === urlBasename) {
        basenameMatches.push(file);
      }
    }
    // Return basename match only when exactly one file matches
    if (basenameMatches.length === 1) {
      return basenameMatches[0];
    }
  }
  return undefined;
}

export function useTaskActivityActorName(
  event: TaskEvent,
  context: TaskActivityRowContext,
): { actorName: string; actorInfo: TaskActivityActorInfo | undefined } {
  const t = useTranslations("App.Tasks.Detail");
  const actorKind = resolveTaskEventActorKind(event);
  const actorLabel =
    actorKind === "coworker"
      ? context.actorCoworkerLabel
      : actorKind === "user"
        ? context.actorUserLabel
        : actorKind === "sokoBot"
          ? context.actorSokoBotLabel
          : context.actorSystemLabel;
  const actorInfo = getEventActorInfo(
    event,
    context.userById,
    context.coworkerById,
    context.sokoBotById,
  );
  const actorName =
    actorInfo?.ownerName != null
      ? t("actorSokoBotWithOwner", {
          assistant: actorInfo.name,
          owner: actorInfo.ownerName,
        })
      : (actorInfo?.name ?? actorLabel);
  return { actorName, actorInfo: actorInfo ?? undefined };
}

export function TaskActivityActorAvatar({
  event,
  actorName,
  actorInfo,
}: {
  event: TaskEvent;
  actorName: string;
  actorInfo: TaskActivityActorInfo | undefined;
}) {
  const actorImage = actorInfo?.image ?? null;
  // Only when the bot has no mascot of its own: a claimed image is
  // its face in chat and the sidebar, and an orb here made the same
  // assistant look like two different ones.
  const showAssistantOrb =
    resolveTaskEventActorKind(event) === "sokoBot" && !actorInfo?.image;

  if (showAssistantOrb) {
    return (
      <AssistantOrb
        seed={actorInfo?.avatarSeed ?? null}
        // Resting eyes so the assistant's comment avatar reads
        // as a face, not a blank disc.
        expression="idle"
        animate={false}
        size={24}
        className="size-6 shrink-0 self-start"
        alt={actorName}
      />
    );
  }

  return (
    <Avatar className="size-6 shrink-0 self-start">
      {actorImage ? <AvatarImage src={actorImage} alt={actorName} /> : null}
      <AvatarFallback className="bg-muted text-[0.625rem]">
        {getInitials(actorName)}
      </AvatarFallback>
    </Avatar>
  );
}

export function TaskActivityEventRow({
  event,
  context,
}: {
  event: TaskEvent;
  context: TaskActivityRowContext;
}) {
  const t = useTranslations("App.Tasks.Detail");
  const tStatus = useTranslations("App.Tasks.Filters.statusOptions");
  const { actorName, actorInfo } = useTaskActivityActorName(event, context);
  const ChannelIcon = CHANNEL_ICON_MAP[event.channel];
  const channelAppName = t(
    `channelApp.${CHANNEL_APP_NAME_KEY_MAP[event.channel]}`,
  );
  const originFromLabel = t("originFromApp", {
    appName: channelAppName,
  });
  const chargePresentation = getTaskEventChargePresentation(event);
  const formattedComment = chargePresentation.hasComment
    ? formatMentionsAsMarkdownLinks(
        event.comment ?? "",
        context.agentNameById,
        context.mentionUserNameById,
      )
    : null;
  const sourceFiles = formattedComment
    ? extractFileLikeLinks(formattedComment).map((url, fileIndex) => {
        const matchedFile = matchTaskFile(url, context.taskFiles);
        if (matchedFile) {
          return {
            id: `${event.id}-file-${fileIndex}`,
            sourceUrl: url,
            fileUrl: matchedFile.fileUrl,
            name: matchedFile.name,
            status: matchedFile.status,
            size: matchedFile.size,
            mimeType: matchedFile.mimeType,
          };
        }
        return {
          id: `${event.id}-file-${fileIndex}`,
          sourceUrl: url,
          fileUrl: url,
          name: getFileNameFromUrl(url),
          status: BlobStatus.READY,
          size: null,
          mimeType: null,
        };
      })
    : [];
  const sourceLinks = formattedComment
    ? extractHttpLinks(formattedComment).map((url, linkIndex) => ({
        id: `${event.id}-link-${linkIndex}`,
        url,
      }))
    : [];
  const hasCommentSources = sourceFiles.length > 0 || sourceLinks.length > 0;
  const chargedLabel = chargePresentation.hasCharge
    ? t(
        chargePresentation.isAttemptedCharge
          ? "actionTriedChargedCredits"
          : "actionChargedCredits",
        {
          credits: formatCreditsForDisplay(event.credits ?? 0),
        },
      )
    : null;
  const action =
    chargePresentation.actionKind === "commented"
      ? context.actionCommentedLabel
      : chargePresentation.actionKind === "charged"
        ? (chargedLabel ?? context.actionUpdatedStatusLabel)
        : context.actionUpdatedStatusLabel;
  const shouldShowSecondaryChargeLine =
    chargePresentation.shouldShowSecondaryChargeLine;
  const shouldShowAuthenticateButton =
    isLatestMatchingStatusEvent(
      event,
      context.latestEventId,
      TaskStatus.AUTHENTICATION_REQUIRED,
    ) && Boolean(event.authenticationUrl);
  const isOutOfCreditsEvent = isLatestMatchingStatusEvent(
    event,
    context.latestEventId,
    TaskStatus.OUT_OF_CREDITS,
  );
  const { viewerPlan } = context;
  // Only link to billing when we know the viewer's plan. Unknown
  // (admin / outside workspace) must not pretend the viewer is free.
  const shouldShowBillingButton = isOutOfCreditsEvent && viewerPlan != null;
  const isFreePlan = viewerPlan === "free";
  const billingCtaLabel = isFreePlan
    ? t("billingCta.upgradePlan")
    : t("billingCta.addCredits");
  const billingCtaHref = isFreePlan
    ? "/billing?tab=subscription"
    : "/billing?tab=credits";
  const billingPlaceholderLabel =
    viewerPlan == null
      ? t("billingCta.statusUnavailable")
      : t("billingCta.placeholder");
  const isCommentEvent = Boolean(formattedComment);
  const isAuthEvent = shouldShowAuthenticateButton;
  const isBillingEvent = isOutOfCreditsEvent;
  const shouldShowBillingPlaceholder = isBillingEvent && !formattedComment;
  const isCardEvent = isCommentEvent || isAuthEvent || isBillingEvent;
  const shouldHighlightDoneBorder =
    event.status === TaskStatus.COMPLETED && isCommentEvent;
  const isStatusOnlyEvent = !isCardEvent && Boolean(event.status);

  return (
    <div
      data-message-id={event.id}
      className={cn(
        "rounded-lg pr-3 pl-3",
        isCardEvent && "bg-card-background border-border border",
        shouldHighlightDoneBorder &&
          getTaskStatusBorderColorClass(TaskStatus.COMPLETED),
      )}
    >
      <div className={cn("flex items-center gap-4", isCardEvent && "py-3")}>
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
          <TaskActivityActorAvatar
            event={event}
            actorName={actorName}
            actorInfo={actorInfo}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-row items-baseline justify-between gap-2">
            <div className="flex flex-wrap items-baseline gap-1.5 text-sm">
              <span className="text-sm font-medium">{actorName}</span>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <span>{action}</span>
                {!event.status ? (
                  <>
                    <span>{originFromLabel}</span>
                    <ChannelIcon
                      className="text-muted-foreground size-3.5 shrink-0"
                      role="img"
                      aria-label={originFromLabel}
                      data-testid={`origin-icon-${event.id}`}
                    />
                  </>
                ) : null}
              </span>
              {event.status ? (
                <>
                  <TaskStatusInline
                    status={event.status}
                    label={tStatus(event.status)}
                  />
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <span>{originFromLabel}</span>
                    <ChannelIcon
                      className="text-muted-foreground size-3.5 shrink-0"
                      role="img"
                      aria-label={originFromLabel}
                      data-testid={`origin-icon-${event.id}`}
                    />
                  </span>
                </>
              ) : null}
            </div>
            <TimeAgo
              date={event.createdAt}
              className="text-muted-foreground text-xs whitespace-nowrap"
            />
          </div>
          {formattedComment ? (
            <ExpandableMarkdown
              content={formattedComment}
              className="prose-sm text-foreground text-sm"
              expandLabel={context.expandLabel}
              collapseLabel={context.collapseLabel}
              fadeClassName="to-transparent"
              defaultOpen={shouldHighlightDoneBorder}
            />
          ) : null}
          {shouldShowBillingPlaceholder ? (
            <p className="text-foreground text-sm">{billingPlaceholderLabel}</p>
          ) : null}
          {hasCommentSources ? (
            <div className="space-y-1.5">
              <Separator className="my-3" />
              {sourceFiles.length > 0 ? (
                <SourcesGrid
                  title={t("sourcesFiles")}
                  blobs={sourceFiles}
                  className="mt-0"
                />
              ) : null}
              {sourceLinks.length > 0 ? (
                <SourcesGrid
                  title={t("sourcesLinks")}
                  links={sourceLinks}
                  className="mt-0"
                />
              ) : null}
            </div>
          ) : null}
          {shouldShowAuthenticateButton ? (
            <div className="flex items-center justify-end gap-2">
              <Button asChild size="sm" variant="default">
                <a
                  href={event.authenticationUrl ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t("authenticate")}
                </a>
              </Button>
            </div>
          ) : null}
          {shouldShowBillingButton ? (
            <div className="flex items-center justify-end gap-2">
              <Button asChild size="sm" variant="default">
                <Link href={billingCtaHref}>{billingCtaLabel}</Link>
              </Button>
            </div>
          ) : null}
          {shouldShowSecondaryChargeLine ? (
            <div className="text-muted-foreground text-xs">{chargedLabel}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
