"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { Paperclip, Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { publishFailureCopy } from "@/app/projects/components/social-posts/social-post-publish-failure";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { SocialPostStatusReasonTooltip } from "@/app/projects/components/social-posts/social-post-status-reason-tooltip";
import { SocialPostThreadBadge } from "@/app/projects/components/social-posts/social-post-thread-badge";
import { useSocialCalendarPreview } from "@/app/social/components/social-calendar-preview";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
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
    status === "PUBLISHING" ||
    status === "NEEDS_APPROVAL"
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
  const label = item.partiallyPublished
    ? copy("thread.partlyPosted")
    : statuses(item.status);
  const labeled = showLabel ?? needsStatusLabel(item.status);
  const badge = (
    <SocialPostStatusBadge
      className={className}
      status={item.status}
      partiallyPublished={item.partiallyPublished}
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
  const social = useTranslations("App.Projects.SocialPosts");
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
    item.partiallyPublished
      ? social("thread.partlyPosted")
      : statuses(item.status),
    item.threadPartCount > 1
      ? social("thread.positionLabel", { part: 1, total: item.threadPartCount })
      : null,
  ]
    .filter(Boolean)
    .join(", ");
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
                  <SocialPostThreadBadge count={item.threadPartCount} />
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
              <SocialPostThreadBadge count={item.threadPartCount} />
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

function SocialPostPreviewCard({
  item,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const social = useTranslations("App.Projects.SocialPosts");
  const formatter = useFormatter();
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const openPreview = useSocialCalendarPreview();
  const scheduler = t("scheduledBy", {
    name: item.scheduledByName ?? t("unknownScheduler"),
  });
  const providerLabel = socialPostProviderLabel(item.provider);
  const handle = formatHandle(item.externalHandle);
  const account = handle ? `${providerLabel} · ${handle}` : providerLabel;
  const className =
    "bg-background text-foreground press hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-stretch gap-1 overflow-hidden rounded-md p-1.5 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo";
  const accessibleName = [
    account,
    formatter.dateTime(item.scheduledAt, "time", { timeZone }),
    t("project", { name: item.projectName }),
    item.text || t("mediaOnly"),
    item.partiallyPublished
      ? social("thread.partlyPosted")
      : statuses(item.status),
    item.threadPartCount > 1
      ? social("thread.positionLabel", { part: 1, total: item.threadPartCount })
      : null,
    scheduler,
    item.attachmentCount > 1
      ? t("attachments", { count: item.attachmentCount })
      : null,
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");
  const content = (
    <>
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
        <SocialPostThreadBadge count={item.threadPartCount} />
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
      aria-label={accessibleName}
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
      aria-label={accessibleName}
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
