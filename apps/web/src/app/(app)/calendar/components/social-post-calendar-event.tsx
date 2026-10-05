"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { Paperclip, Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { SocialPostStatusBadge } from "@/app/projects/components/social-posts/social-post-status-badge";
import { useSocialCalendarPreview } from "@/app/social/components/social-calendar-preview";
import { SocialPostProviderIcon } from "@/components/social-post-provider-icon";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";

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
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
  variant?: "compact" | "preview";
}) {
  if (variant === "compact") {
    return <CompactSocialPostCalendarEvent item={item} timeZone={timeZone} />;
  }
  return <SocialPostPreviewCard item={item} timeZone={timeZone} />;
}

function CompactSocialPostCalendarEvent({
  item,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const formatter = useFormatter();
  const label = t("compactLabel", {
    provider: socialPostProviderLabel(item.provider),
    media: item.previewMedia?.kind ?? "none",
    count: item.attachmentCount,
  });
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bg-background text-foreground press hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none items-center gap-1 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo"
          data-testid="calendar-social-post"
        >
          <SocialPostProviderIcon
            provider={item.provider}
            aria-hidden
            className="size-3 shrink-0"
          />
          <span className="text-muted-foreground shrink-0 tabular-nums">
            {formatter.dateTime(item.scheduledAt, "time", { timeZone })}
          </span>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <SocialPostStatusBadge
            status={item.status}
            label={statuses(item.status)}
            showLabel={false}
          />
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
  const statuses = useTranslations("App.Projects.SocialPosts.status");
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
        <SocialPostStatusBadge
          status={item.status}
          label={statuses(item.status)}
          showLabel={false}
        />
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

/**
 * The post's first attachment, as the reader will see it in the feed. It is
 * decorative here: the text and status already name the post, and the whole
 * card is the link.
 */
function SocialPostCalendarPreview({
  media,
}: {
  media: NonNullable<SocialPostCalendarItem["previewMedia"]>;
}) {
  return (
    <span
      aria-hidden
      className="bg-muted relative block aspect-video w-full overflow-hidden rounded"
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
          <span className="bg-background text-foreground absolute inset-0 m-auto flex size-6 items-center justify-center rounded-full">
            <Play className="size-3 fill-current" />
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
