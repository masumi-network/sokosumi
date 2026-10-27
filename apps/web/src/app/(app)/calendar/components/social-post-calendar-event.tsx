"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { CalendarClock, GripVertical, Paperclip, Play } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";
import { publishFailureCopy } from "@/app/projects/components/social-posts/social-post-publish-failure";
import {
  SocialPostStatusBadge,
  socialPostStatusTone,
} from "@/app/projects/components/social-posts/social-post-status-badge";
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
import { getToneStyle } from "@/components/ui/status-marker";
import { UserProfileAvatar } from "@/components/user/user-profile-avatar";
import { useSocialProviderAvailability } from "@/contexts/social-provider-availability-context";
import { cn } from "@/lib/utils";
import { isChangeableSocialPost } from "./social-post-change";

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
  const formatter = useFormatter();
  const { enabledProviders } = useSocialProviderAvailability();
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
      reason={publishFailureCopy(
        item,
        copy,
        (values) => formatter.list(values, { type: "conjunction" }),
        enabledProviders,
      )}
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
 * `month` and `week` are the chips Social's own calendar draws: one shape in
 * both views, a single line on the month and the same line with the post's
 * words, account and media on the week. `preview` is the feed-like card.
 * `compact` is the one line the workspace Calendar draws among task runs
 * ("X post with video"); pressing it expands the preview card in a popover.
 */
export function SocialPostCalendarEvent({
  item,
  timeZone,
  variant = "preview",
  showThumb = false,
  showProject = true,
  onReschedule,
}: {
  item: SocialPostCalendarItem;
  timeZone: string;
  variant?: "compact" | "preview" | "month" | "week";
  /** Square media preview on a compact chip. Workspace compact stays one line. */
  showThumb?: boolean;
  /** Off when the calendar is one project's: every chip would repeat it. */
  showProject?: boolean;
  /** Week chips of movable posts offer a Reschedule button: the drag without a pointer. */
  onReschedule?: (item: SocialPostCalendarItem) => void;
}) {
  if (variant === "month" || variant === "week") {
    return (
      <SocialPostCalendarChip
        density={variant}
        item={item}
        onReschedule={variant === "week" ? onReschedule : undefined}
        showProject={showProject}
        timeZone={timeZone}
      />
    );
  }
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
  const formatter = useFormatter();
  const openPreview = useSocialCalendarPreview();
  const { account, accessibleName, handle, providerLabel, scheduler } =
    useSocialPostCalendarCopy(item, timeZone);
  const className =
    "bg-background text-foreground press hover:bg-muted border border-border flex w-full min-w-0 cursor-pointer select-none flex-col items-stretch gap-1 overflow-hidden rounded-md p-1.5 text-left text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-halo";
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

/** The words every Social calendar card says about a post, aloud and on screen. */
function useSocialPostCalendarCopy(
  item: SocialPostCalendarItem,
  timeZone: string,
  showProject = true,
) {
  const t = useTranslations("App.Calendar.socialPost");
  const formatter = useFormatter();
  const social = useTranslations("App.Projects.SocialPosts");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const scheduler = t("scheduledBy", {
    name: item.scheduledByName ?? t("unknownScheduler"),
  });
  const providerLabel = socialPostProviderLabel(item.provider);
  const handle = formatHandle(item.externalHandle);
  const account = handle ? `${providerLabel} · ${handle}` : providerLabel;
  const accessibleName = [
    account,
    formatter.dateTime(item.scheduledAt, "time", { timeZone }),
    showProject ? t("project", { name: item.projectName }) : null,
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
  return { account, accessibleName, handle, providerLabel, scheduler };
}

/**
 * How a chip says its status without leaning on hue: the glyph is always
 * there, a post someone still has to finish has a dashed edge, a canceled one
 * is struck through, and a post that needs the reader names its status in
 * words on the week.
 */
const DASHED_STATUSES: ReadonlySet<SocialPostCalendarItem["status"]> = new Set([
  "DRAFT",
  "NEEDS_APPROVAL",
  "CANCELED",
]);
const WORDED_STATUSES: ReadonlySet<SocialPostCalendarItem["status"]> = new Set([
  "FAILED",
  "MISSED",
  "NEEDS_APPROVAL",
  "PUBLISHING",
  "CANCELED",
  "DRAFT",
]);

/**
 * Social's calendar chip, one shape for the month and the week.
 *
 * A status rail and glyph lead, then the platform, the time and the post's
 * first words. The week adds the account, a few lines of text, the media
 * thumb and the status word. A post that can still move carries a grip and
 * says so to assistive tech; the drag itself stays FullCalendar's.
 */
function SocialPostCalendarChip({
  density,
  item,
  onReschedule,
  showProject,
  timeZone,
}: {
  density: "month" | "week";
  item: SocialPostCalendarItem;
  onReschedule?: (item: SocialPostCalendarItem) => void;
  showProject: boolean;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar.socialPost");
  const formatter = useFormatter();
  const openPreview = useSocialCalendarPreview();
  const dragHintId = useId();
  const { account, accessibleName, handle, providerLabel } =
    useSocialPostCalendarCopy(item, timeZone, showProject);
  const movable = isChangeableSocialPost(item);
  const reschedule = movable ? onReschedule : undefined;
  const tone = getToneStyle(socialPostStatusTone(item.status));
  const week = density === "week";
  const time = formatter.dateTime(item.scheduledAt, "time", { timeZone });
  const className = cn(
    "group/chip bg-background text-foreground press hover:bg-muted border-border relative flex w-full min-w-0 select-none overflow-hidden rounded-md border text-start text-xs font-medium motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out focus-visible:ring-ring-halo focus-visible:ring-2 focus-visible:outline-none",
    week
      ? "@container flex-col gap-1 py-1.5 ps-2.5 pe-1.5"
      : "items-center gap-1 py-0.5 ps-2 pe-1",
    DASHED_STATUSES.has(item.status) && "border-dashed",
    movable ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
  );
  const rail = (
    <span
      aria-hidden
      className={cn(
        "absolute inset-y-1 start-0.5 w-0.5 rounded-full",
        tone.dot,
      )}
      data-testid="calendar-social-post-rail"
    />
  );
  const grip = movable ? (
    <GripVertical
      aria-hidden
      className={cn(
        "text-muted-foreground size-3 shrink-0",
        // The month has no room to spare: the grip shows when it is wanted.
        !week && "hidden group-hover/chip:block group-focus-visible/chip:block",
      )}
      data-testid="calendar-social-post-grip"
    />
  ) : null;
  const text = (
    <span
      className={cn(
        "min-w-0 font-normal",
        week ? "line-clamp-3 break-words" : "flex-1 truncate",
        item.status === "CANCELED" && "text-muted-foreground line-through",
      )}
    >
      {item.text || t("mediaOnly")}
    </span>
  );
  const content = week ? (
    <>
      {rail}
      <span className="flex w-full min-w-0 items-center gap-1.5">
        <AccountChipMark avatarUrl={item.avatarUrl} provider={item.provider} />
        {/* A narrow column would cut the handle to a bare "@": the mark and
            the accessible name still say whose post it is. */}
        <span
          className="min-w-0 flex-1 truncate @max-[8rem]:hidden"
          title={account}
        >
          {handle ?? providerLabel}
        </span>
        <span className="text-muted-foreground ms-auto shrink-0 tabular-nums">
          {time}
        </span>
      </span>
      <span className="flex w-full min-w-0 items-start gap-1.5">
        <span className="flex min-w-0 flex-1">{text}</span>
        {item.previewMedia ? (
          <CompactSocialPostThumb media={item.previewMedia} />
        ) : null}
      </span>
      <span
        className={cn(
          "flex w-full min-w-0 items-center gap-1",
          // Room for the Reschedule button laid over this row's end.
          reschedule && "pe-7",
        )}
      >
        <CalendarSocialPostStatus
          className={
            WORDED_STATUSES.has(item.status) ? "px-1.5 py-0.5" : "size-5"
          }
          item={item}
          showLabel={WORDED_STATUSES.has(item.status)}
        />
        <SocialPostThreadBadge count={item.threadPartCount} />
        <span
          className="text-muted-foreground min-w-0 flex-1 truncate font-normal"
          title={
            showProject ? t("project", { name: item.projectName }) : undefined
          }
        >
          {showProject ? item.projectName : null}
        </span>
        {grip}
      </span>
    </>
  ) : (
    <>
      {rail}
      <CalendarSocialPostStatus
        className="size-4 rounded-full"
        item={item}
        showLabel={false}
      />
      <SocialPostProviderIcon
        aria-hidden
        className="size-3 shrink-0"
        provider={item.provider}
      />
      <span className="text-muted-foreground shrink-0 tabular-nums">
        {time}
      </span>
      {text}
      {grip}
    </>
  );
  const shared = {
    "aria-describedby": movable ? dragHintId : undefined,
    "aria-label": accessibleName,
    className,
    "data-density": density,
    "data-movable": movable ? "true" : undefined,
    "data-status": item.status,
    "data-testid": "calendar-social-post",
  };
  const chip = (
    <>
      {openPreview ? (
        <button
          type="button"
          {...shared}
          onClick={(event) =>
            openPreview(item.sourceProjectId, item.postId, event.currentTarget)
          }
        >
          {content}
        </button>
      ) : (
        <Link href={socialPostHref(item)} {...shared}>
          {content}
        </Link>
      )}
      {movable ? (
        <span className="sr-only" id={dragHintId}>
          {t("dragHint")}
        </span>
      ) : null}
    </>
  );
  if (!reschedule) return chip;
  // A sibling of the chip, not inside it: a button cannot hold a button.
  return (
    <div className="relative">
      {chip}
      <button
        aria-label={t("rescheduleNamed", {
          time,
          text: item.text || t("mediaOnly"),
        })}
        className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring-halo hit-area absolute end-1 bottom-1 flex size-6 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out"
        data-testid="calendar-social-post-reschedule"
        onClick={() => reschedule(item)}
        title={t("reschedule")}
        type="button"
      >
        <CalendarClock aria-hidden className="size-4" />
      </button>
    </div>
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
