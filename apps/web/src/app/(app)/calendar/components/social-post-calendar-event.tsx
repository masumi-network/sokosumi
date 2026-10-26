"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { GripVertical, Paperclip, Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { ComponentProps, DragEvent, ReactNode } from "react";
import { publishFailureCopy } from "@/app/projects/components/social-posts/social-post-publish-failure";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostStatusReasonTooltip } from "@/app/projects/components/social-posts/social-post-status-reason-tooltip";
import { useSocialCalendarPreview } from "@/app/social/components/social-calendar-preview";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import {
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import { cn } from "@/lib/utils";

/** Failed, missed, canceled, and publishing posts need the word, not only a coloured mark. */
function needsStatusLabel(status: SocialPostCalendarItem["status"]) {
  return (
    status === "FAILED" ||
    status === "MISSED" ||
    status === "CANCELED" ||
    status === "PUBLISHING"
  );
}

function CalendarSocialPostStatus({
  item,
  showLabel,
  className,
}: {
  item: SocialPostCalendarItem;
  /** Week chips stay icon-only so the word does not crowd the thumb. */
  showLabel?: boolean;
  className?: string;
}) {
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const copy = useTranslations("App.Projects.SocialPosts");
  const label = statuses(item.status);
  const labeled = showLabel ?? needsStatusLabel(item.status);
  const badge = (
    <SocialPostStatusBadge
      className={className}
      status={item.status}
      label={label}
      showLabel={labeled}
    />
  );
  if (item.status !== "FAILED" && item.status !== "MISSED") return badge;
  return (
    <SocialPostStatusReasonTooltip
      label={label}
      reason={publishFailureCopy(item, copy)}
    >
      {badge}
    </SocialPostStatusReasonTooltip>
  );
}

/** The post on Social, scoped to its project and opened in its list. */
function socialPostHref(item: SocialPostCalendarItem): string {
  const query = new URLSearchParams({
    projectId: item.sourceProjectId,
    postId: item.postId,
  });
  if (item.status === "FAILED" || item.status === "MISSED") {
    query.set("tab", "attention");
  }
  return `/social?${query}#social-post-${encodeURIComponent(item.postId)}`;
}

function formatHandle(handle: string | null): string | null {
  if (!handle) return null;
  return handle.startsWith("@") ? handle : `@${handle}`;
}

/**
 * A Social post on a calendar.
 *
 * `preview` is the feed-like card Social's own calendar draws. `compact` is
 * the one line the workspace Calendar draws among task runs ("X post with
 * video"); pressing it expands the same preview card in a popover.
 */
export function SocialPostCalendarEvent({
  item,
  timeZone,
  variant = "preview",
  showThumb = false,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
  variant?: "compact" | "preview";
  /** Square media preview on Social's week chips. Workspace compact stays one line. */
  showThumb?: boolean;
}) {
  if (variant === "compact") {
    return (
      <CompactSocialPostCalendarEvent
        item={item}
        showThumb={showThumb}
        timeZone={timeZone}
      />
    );
  }
  return <SocialPostPreviewCard item={item} timeZone={timeZone} />;
}

function CompactSocialPostCalendarEvent({
  item,
  showThumb,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  showThumb: boolean;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const formatter = useFormatter();
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const label = t("compactLabel", {
    provider: socialPostProviderLabel(item.provider),
    media: item.previewMedia?.kind ?? "none",
    count: item.attachmentCount,
  });
  const media = showThumb ? item.previewMedia : null;
  const time = (
    <span
      className={cn(
        "text-muted-foreground tabular-nums",
        showThumb ? "min-w-0 truncate" : "shrink-0",
      )}
    >
      {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
    </span>
  );
  const status = (
    <CalendarSocialPostStatus
      className={showThumb ? "size-4" : undefined}
      item={item}
      showLabel={showThumb ? false : undefined}
    />
  );
  const logo = (
    <SocialPostProviderIcon
      provider={item.provider}
      aria-hidden
      className="size-3 shrink-0"
    />
  );
  const accessibleName = [
    formatter.dateTime(item.scheduledAt, "time", { timeZone }),
    label,
    statuses(item.status),
  ].join(", ");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={accessibleName}
          className={cn(
            "bg-background text-foreground press hover:bg-muted border-border flex w-full max-w-full min-w-0 cursor-pointer select-none overflow-hidden rounded border text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:ring-ring-halo focus-visible:ring-2 focus-visible:outline-none",
            showThumb
              ? "@container items-center gap-1 px-1 py-1"
              : "items-center gap-1 px-1.5 py-1",
          )}
          data-testid="calendar-social-post"
        >
          {showThumb ? (
            <>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5 overflow-hidden">
                <span className="flex min-w-0 flex-nowrap items-center gap-0.5">
                  {logo}
                  {time}
                  <span className="shrink-0">{status}</span>
                </span>
                <span className="w-full min-w-0 truncate">{label}</span>
              </span>
              {media ? <CompactSocialPostThumb media={media} /> : null}
            </>
          ) : (
            <>
              {logo}
              {time}
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {status}
            </>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <SocialPostPreviewCard item={item} timeZone={timeZone} />
      </PopoverContent>
    </Popover>
  );
}

/** What a post card says about its post, for sight and for assistive tech. */
function useSocialPostCardCopy(item: SocialPostCalendarItem, timeZone: string) {
  const t = useTranslations("App.Calendar.socialPost");
  const formatter = useFormatter();
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const scheduler = t("scheduledBy", {
    name: item.scheduledByName ?? t("unknownScheduler"),
  });
  const providerLabel = socialPostProviderLabel(item.provider);
  const handle = formatHandle(item.externalHandle);
  const account = handle ? `${providerLabel} · ${handle}` : providerLabel;
  const time = formatter.dateTime(item.scheduledAt, "time", { timeZone });
  const accessibleName = [
    account,
    time,
    t("project", { name: item.projectName }),
    item.text || t("mediaOnly"),
    statuses(item.status),
    scheduler,
    item.attachmentCount > 1
      ? t("attachments", { count: item.attachmentCount })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  return { account, accessibleName, handle, providerLabel, scheduler, time };
}

interface PlannerCardDragHandlers {
  onDragStart?: (event: DragEvent<HTMLElement>) => void;
  onDragEnd?: (event: DragEvent<HTMLElement>) => void;
}

/** Opens the post's preview where Social provides one, else its list row. */
function SocialPostCardAction({
  item,
  accessibleName,
  className,
  children,
  ...props
}: {
  item: SocialPostCalendarItem;
  accessibleName: string;
  className: string;
  children: ReactNode;
} & Pick<ComponentProps<"button">, "aria-describedby" | "draggable"> &
  PlannerCardDragHandlers) {
  const openPreview = useSocialCalendarPreview();
  return openPreview ? (
    <button
      type="button"
      aria-label={accessibleName}
      className={className}
      data-testid="calendar-social-post"
      onClick={(event) =>
        openPreview(item.sourceProjectId, item.postId, event.currentTarget)
      }
      {...props}
    >
      {children}
    </button>
  ) : (
    <Link
      href={socialPostHref(item)}
      aria-label={accessibleName}
      className={className}
      data-testid="calendar-social-post"
      {...props}
    >
      {children}
    </Link>
  );
}

function SocialPostPreviewCard({
  item,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const { account, accessibleName, handle, providerLabel, scheduler, time } =
    useSocialPostCardCopy(item, timeZone);
  const className =
    "bg-background text-foreground press hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-stretch gap-1 overflow-hidden rounded-md p-1.5 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo";
  return (
    <SocialPostCardAction
      item={item}
      accessibleName={accessibleName}
      className={className}
    >
      <span className="flex w-full min-w-0 items-center gap-1">
        <span
          className="flex size-6 shrink-0 items-center justify-center"
          role="img"
          aria-label={account}
          title={account}
        >
          <AccountChipMark
            avatarUrl={item.avatarUrl}
            provider={item.provider}
          />
        </span>
        <span aria-hidden className="min-w-0 flex-1 truncate">
          {handle ?? providerLabel}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {time}
        </span>
      </span>
      <span
        className="text-muted-foreground w-full min-w-0 truncate font-normal"
        title={t("project", { name: item.projectName })}
      >
        <span className="sr-only">{t("projectLabel")}</span>
        {item.projectName}
      </span>
      {item.previewMedia ? (
        <SocialPostCalendarPreview media={item.previewMedia} />
      ) : null}
      <span className="line-clamp-2 w-full min-w-0 break-words font-normal">
        {item.text || t("mediaOnly")}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1">
        <CalendarSocialPostStatus item={item} />
        <span aria-hidden className="flex shrink-0" title={scheduler}>
          <UserProfileAvatar
            name={item.scheduledByName ?? ""}
            image={item.scheduledByImage}
          />
        </span>
        <span className="sr-only">{scheduler}</span>
        <SocialPostAttachmentCount item={item} className="ml-auto" />
      </span>
    </SocialPostCardAction>
  );
}

function SocialPostAttachmentCount({
  item,
  className,
}: {
  item: SocialPostCalendarItem;
  className?: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  if (item.attachmentCount <= 1) return null;
  const label = t("attachments", { count: item.attachmentCount });
  return (
    <span
      className={cn(
        "text-muted-foreground flex shrink-0 items-center gap-1",
        className,
      )}
      title={label}
    >
      <Paperclip aria-hidden className="size-3" />
      <span aria-hidden className="tabular-nums">
        {item.attachmentCount}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * A post in Social's planner: a day lane or the selected day's list.
 *
 * It answers, in reading order, when it goes out, from which account, what it
 * says and where it stands. The status always carries its word; the handle
 * wraps rather than truncating to "@"; the project is named only where posts
 * from several projects share the calendar. It narrows to a week lane by
 * container width, dropping the thumbnail first.
 */
export function SocialPostPlannerCard({
  item,
  timeZone,
  showProject,
  moving = false,
  dragHintId,
  onDragStart,
  onDragEnd,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
  showProject: boolean;
  /** Rendered at its dropped time while Core confirms the move. */
  moving?: boolean;
  /** Set on a post that can be dragged to another day. */
  dragHintId?: string;
} & PlannerCardDragHandlers) {
  const t = useTranslations("App.Calendar.socialPost");
  const { accessibleName, handle, providerLabel, time } = useSocialPostCardCopy(
    item,
    timeZone,
  );
  const draggable = dragHintId !== undefined;
  return (
    <SocialPostCardAction
      item={item}
      accessibleName={accessibleName}
      aria-describedby={dragHintId}
      className={cn(
        HOLDER_ITEM_CLASS,
        HOLDER_ITEM_HOVER_CLASS,
        "@container text-foreground press group/post relative flex w-full min-w-0 select-none items-start gap-3 p-2.5 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring-halo focus-visible:inset-ring-1 focus-visible:inset-ring-ring motion-safe:transition-[background-color,opacity] motion-safe:duration-150 motion-safe:ease-out",
        draggable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        moving && "opacity-60",
      )}
      draggable={draggable || undefined}
      onDragEnd={onDragEnd}
      onDragStart={onDragStart}
    >
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="text-sm font-semibold tabular-nums">{time}</span>
          {draggable ? (
            <GripVertical
              aria-hidden
              className="text-muted-foreground ms-auto size-3.5 shrink-0 opacity-0 group-hover/post:opacity-100 group-focus-visible/post:opacity-100 motion-safe:transition-opacity"
              data-testid="planner-post-grip"
            />
          ) : null}
        </span>
        <span className="flex min-w-0 items-start gap-1.5">
          <AccountChipMark
            avatarUrl={item.avatarUrl}
            provider={item.provider}
          />
          <span className="flex min-w-0 flex-col">
            <span className="font-medium break-all">
              {handle ?? providerLabel}
            </span>
            <span className="text-muted-foreground flex items-center gap-1">
              <SocialPostProviderIcon
                provider={item.provider}
                aria-hidden
                className="size-3 shrink-0"
              />
              {providerLabel}
            </span>
          </span>
        </span>
        <span className="line-clamp-3 min-w-0 break-words text-sm">
          {item.text || (
            <span className="text-muted-foreground">{t("mediaOnly")}</span>
          )}
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <CalendarSocialPostStatus item={item} showLabel />
          {showProject ? (
            <span className="text-muted-foreground min-w-0 truncate">
              <span className="sr-only">{t("projectLabel")}</span>
              {item.projectName}
            </span>
          ) : null}
          <SocialPostAttachmentCount item={item} />
        </span>
      </span>
      {item.previewMedia ? (
        <span
          className="bg-muted border-border relative hidden size-14 shrink-0 overflow-hidden rounded-md border @[15rem]:block"
          data-testid="calendar-social-post-thumb"
        >
          <SocialPostCalendarPreview media={item.previewMedia} fill />
        </span>
      ) : null}
    </SocialPostCardAction>
  );
}

/** Square first-frame on a week chip. Absent when the post has no media. */
function CompactSocialPostThumb({
  media,
}: {
  media: NonNullable<SocialPostCalendarItem["previewMedia"]>;
}) {
  return (
    <span
      className="bg-muted border-border relative size-7 shrink-0 overflow-hidden rounded-md border @max-[6.875rem]:hidden"
      data-testid="calendar-social-post-thumb"
    >
      <span aria-hidden className="absolute inset-0">
        <SocialPostCalendarPreview media={media} fill />
      </span>
      {media.kind === "gif" ? (
        <span
          aria-hidden
          className="bg-scrim-strong text-on-media absolute start-0 bottom-0 rounded-se px-0.5 text-2xs font-semibold leading-none"
          data-testid="social-post-preview-gif"
        >
          GIF
        </span>
      ) : null}
    </span>
  );
}

/**
 * The post's first attachment, as the reader will see it in the feed. It is
 * decorative here: the text and status already name the post, and the whole
 * card is the link.
 */
function SocialPostCalendarPreview({
  fill = false,
  media,
}: {
  fill?: boolean;
  media: NonNullable<SocialPostCalendarItem["previewMedia"]>;
}) {
  return (
    <span
      aria-hidden
      className={
        fill
          ? "absolute inset-0"
          : "bg-muted relative block aspect-video w-full overflow-hidden rounded"
      }
    >
      {media.kind === "video" ? (
        <>
          <video
            className="size-full object-cover"
            muted
            playsInline
            preload="metadata"
            src={media.fileUrl}
          />
          <span
            className={cn(
              "bg-background text-foreground absolute inset-0 m-auto flex items-center justify-center rounded-full",
              fill ? "size-3" : "size-6",
            )}
          >
            <Play className={cn("fill-current", fill ? "size-2" : "size-3")} />
          </span>
        </>
      ) : (
        <>
          <img
            alt=""
            className="size-full object-cover"
            decoding="async"
            loading="lazy"
            src={media.fileUrl}
          />
          {media.kind === "gif" && !fill ? (
            <span
              className="bg-scrim-strong text-on-media absolute bottom-1 start-1 rounded px-1.5 py-0.5 text-2xs font-semibold"
              data-testid="calendar-social-post-gif"
            >
              GIF
            </span>
          ) : null}
        </>
      )}
    </span>
  );
}
