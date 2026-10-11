"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { Paperclip, Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { publishFailureCopy } from "@/app/projects/components/social-posts/social-post-publish-failure";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostStatusReasonTooltip } from "@/app/projects/components/social-posts/social-post-status-reason-tooltip";
import { useSocialCalendarPreview } from "@/app/social/components/social-calendar-preview";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import { cn } from "@/lib/utils";

/** Failed and missed posts need the word, not only a coloured mark. */
function needsStatusLabel(status: SocialPostCalendarItem["status"]) {
  return status === "FAILED" || status === "MISSED";
}

function CalendarSocialPostStatus({
  item,
  showLabel,
}: {
  item: SocialPostCalendarItem;
  /** Week media chips stay icon-only so the word does not crowd the thumb. */
  showLabel?: boolean;
}) {
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const copy = useTranslations("App.Projects.SocialPosts");
  const label = statuses(item.status);
  const labeled = showLabel ?? needsStatusLabel(item.status);
  const badge = (
    <SocialPostStatusBadge
      status={item.status}
      label={label}
      showLabel={labeled}
    />
  );
  if (!needsStatusLabel(item.status)) return badge;
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
  return `/social?${query}#social-post-${encodeURIComponent(item.postId)}`;
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
  const label = t("compactLabel", {
    provider: socialPostProviderLabel(item.provider),
    media: item.previewMedia?.kind ?? "none",
    count: item.attachmentCount,
  });
  const media = showThumb ? item.previewMedia : null;
  const time = (
    <span className="text-muted-foreground shrink-0 tabular-nums">
      {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
    </span>
  );
  const status = (
    <CalendarSocialPostStatus
      item={item}
      showLabel={showThumb ? false : undefined}
    />
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "@container bg-background text-foreground press hover:bg-muted border-border flex w-full max-w-full min-w-0 cursor-pointer select-none items-center overflow-hidden rounded border text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:ring-ring-halo focus-visible:ring-2 focus-visible:outline-none",
            media ? "gap-1 px-1 py-1" : "gap-1 px-1.5 py-1",
          )}
          data-testid="calendar-social-post"
        >
          <SocialPostProviderIcon
            provider={item.provider}
            aria-hidden
            className="size-3 shrink-0"
          />
          {media ? (
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex min-w-0 items-center gap-1">
                {time}
                <span className="shrink-0">{status}</span>
              </span>
              <span className="min-w-0 truncate">{label}</span>
            </span>
          ) : (
            <>
              {time}
              <span className="min-w-0 flex-1 truncate">{label}</span>
              {status}
            </>
          )}
          {media ? <CompactSocialPostThumb media={media} /> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <SocialPostPreviewCard item={item} timeZone={timeZone} />
      </PopoverContent>
    </Popover>
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
  const formatter = useFormatter();
  const openPreview = useSocialCalendarPreview();
  const scheduler = t("scheduledBy", {
    name: item.scheduledByName ?? t("unknownScheduler"),
  });
  const providerLabel = socialPostProviderLabel(item.provider);
  const account = item.externalHandle
    ? `${providerLabel} · @${item.externalHandle}`
    : providerLabel;
  const className =
    "bg-background text-foreground press hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-stretch gap-1 overflow-hidden rounded-md p-1.5 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo";
  const content = (
    <>
      <span className="flex w-full min-w-0 items-center gap-1">
        <span
          className="flex size-4 shrink-0 items-center justify-center"
          title={account}
        >
          <SocialPostProviderIcon
            provider={item.provider}
            role="img"
            aria-label={account}
            className="size-3"
          />
        </span>
        <span aria-hidden className="min-w-0 flex-1 truncate">
          {item.externalHandle ? `@${item.externalHandle}` : providerLabel}
        </span>
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
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
        {item.attachmentCount > 1 ? (
          <span
            className="text-muted-foreground ml-auto flex shrink-0 items-center gap-1"
            title={t("attachments", { count: item.attachmentCount })}
          >
            <Paperclip aria-hidden className="size-3" />
            <span aria-hidden className="tabular-nums">
              {item.attachmentCount}
            </span>
            <span className="sr-only">
              {t("attachments", { count: item.attachmentCount })}
            </span>
          </span>
        ) : null}
      </span>
    </>
  );
  return openPreview ? (
    <button
      type="button"
      className={className}
      data-testid="calendar-social-post"
      onClick={(event) =>
        openPreview(item.sourceProjectId, item.postId, event.currentTarget)
      }
    >
      {content}
    </button>
  ) : (
    <Link
      href={socialPostHref(item)}
      className={className}
      data-testid="calendar-social-post"
    >
      {content}
    </Link>
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
      className="relative size-6 shrink-0 overflow-hidden rounded-md @max-[8rem]:hidden"
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
        <img
          alt=""
          className="size-full object-cover"
          decoding="async"
          loading="lazy"
          src={media.fileUrl}
        />
      )}
    </span>
  );
}
