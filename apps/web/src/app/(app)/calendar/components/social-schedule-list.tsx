"use client";

import type { SocialPostCalendarItem } from "@sokosumi/core-client";
import { socialPostProviderLabel } from "@sokosumi/utils";
import { CalendarClock, Paperclip, Plus } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { AccountChipMark } from "@/components/social-account-chip-mark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import {
  CalendarSocialPostStatus,
  CompactSocialPostThumb,
  formatHandle,
  SocialPostOpenTarget,
} from "./social-post-calendar-event";
import { isChangeableSocialPost } from "./social-post-change";

export interface SocialScheduleDay {
  /** The calendar day, `yyyy-MM-dd`, in the calendar's zone. */
  key: string;
  /** That day's posts, in time order. */
  posts: SocialPostCalendarItem[];
}

interface SocialScheduleListProps {
  days: SocialScheduleDay[];
  todayKey: string;
  timeZone: string;
  /** A calendar locked to one project need not repeat its name on every row. */
  showProject: boolean;
  /** Starts a post on that day; absent where no composer can open. */
  onCreate?: (day: string) => void;
  onReschedule: (item: SocialPostCalendarItem) => void;
}

/**
 * Social's schedule as a list: every day of the week in order, each post on
 * its own row at its time. A day with nothing on it still has its line, so
 * the gaps in the week are as easy to read as the posts. This is the phone's
 * default and the keyboard's way to move a post (Reschedule on the row).
 */
export function SocialScheduleList({
  days,
  todayKey,
  timeZone,
  showProject,
  onCreate,
  onReschedule,
}: SocialScheduleListProps) {
  const t = useTranslations("App.Calendar");
  const formatDate = useFormatter().dateTime;

  return (
    <div
      className={cn(HOLDER_CLASS, "flex flex-col gap-1")}
      data-testid="calendar-list"
    >
      {days.map(({ key, posts }) => {
        // The key is already the day in the calendar's zone; read it as UTC
        // so the formatter does not shift it into another one.
        const day = new Date(`${key}T12:00:00Z`);
        const dayLabel = formatDate(day, {
          weekday: "long",
          month: "short",
          day: "numeric",
          timeZone: "UTC",
        });
        const isToday = key === todayKey;
        const headingId = `social-schedule-${key}`;
        return (
          <section
            aria-labelledby={headingId}
            className="flex flex-col gap-1.5"
            data-past={key < todayKey ? "true" : undefined}
            data-testid={`calendar-list-day-${key}`}
            key={key}
          >
            <div className="bg-card-background sticky top-0 z-10 flex min-h-10 items-center gap-2 px-2 pt-1">
              <h3
                className={cn(
                  "text-sm font-semibold",
                  key < todayKey && "text-muted-foreground",
                )}
                id={headingId}
              >
                {dayLabel}
              </h3>
              {isToday ? (
                <Badge variant="secondary">{t("list.today")}</Badge>
              ) : null}
              <span className="text-muted-foreground text-xs tabular-nums">
                {posts.length === 0
                  ? t("list.empty")
                  : t("list.count", { count: posts.length })}
              </span>
              {onCreate && key >= todayKey ? (
                <Button
                  aria-label={t("list.createOn", { day: dayLabel })}
                  className="ms-auto h-10 md:h-8"
                  onClick={() => onCreate(key)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Plus aria-hidden className="size-4" />
                  <span className="max-sm:sr-only">{t("list.create")}</span>
                </Button>
              ) : null}
            </div>
            {posts.length > 0 ? (
              <ul className="flex flex-col gap-1.5 pb-2">
                {posts.map((item) => (
                  <SocialScheduleRow
                    item={item}
                    key={item.id}
                    onReschedule={onReschedule}
                    showProject={showProject}
                    timeZone={timeZone}
                  />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function SocialScheduleRow({
  item,
  onReschedule,
  showProject,
  timeZone,
}: {
  item: SocialPostCalendarItem;
  onReschedule: (item: SocialPostCalendarItem) => void;
  showProject: boolean;
  timeZone: string;
}) {
  const t = useTranslations("App.Calendar");
  const statuses = useTranslations("App.Projects.SocialPosts.status");
  const formatDate = useFormatter().dateTime;
  const time = formatDate(item.scheduledAt, "time", { timeZone });
  const providerLabel = socialPostProviderLabel(item.provider);
  const handle = formatHandle(item.externalHandle);
  const text = item.text || t("socialPost.mediaOnly");
  const accessibleName = [
    time,
    handle ? `${providerLabel} · ${handle}` : providerLabel,
    showProject ? t("socialPost.project", { name: item.projectName }) : null,
    text,
    statuses(item.status),
  ]
    .filter((part): part is string => Boolean(part))
    .join(", ");

  return (
    <li
      className={cn(
        HOLDER_ITEM_CLASS,
        HOLDER_ITEM_HOVER_CLASS,
        "@container relative flex items-start gap-3 px-3 py-2.5",
      )}
      data-testid="calendar-list-row"
    >
      <time
        className="w-16 shrink-0 pt-0.5 text-sm font-medium tabular-nums"
        dateTime={item.scheduledAt.toISOString()}
      >
        {time}
      </time>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 items-center gap-1.5 text-xs">
          <AccountChipMark
            avatarUrl={item.avatarUrl}
            provider={item.provider}
          />
          <span className="min-w-0 truncate font-medium">
            {handle ?? providerLabel}
          </span>
          {handle ? (
            <span className="text-muted-foreground shrink-0">
              {providerLabel}
            </span>
          ) : null}
          {showProject ? (
            <span className="text-muted-foreground min-w-0 truncate">
              · {item.projectName}
            </span>
          ) : null}
        </div>
        {/* The text is the row's target; its ::after spreads the hit area
            over the whole row, under the status and Reschedule controls. */}
        <SocialPostOpenTarget
          accessibleName={accessibleName}
          className="line-clamp-2 min-w-0 break-words text-start text-sm outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-ring-halo focus-visible:after:inset-ring-1 focus-visible:after:inset-ring-ring"
          item={item}
        >
          {text}
        </SocialPostOpenTarget>
        <div className="relative z-10 flex w-fit items-center gap-2">
          <CalendarSocialPostStatus item={item} showLabel />
          {item.attachmentCount > 1 ? (
            <span className="text-muted-foreground flex items-center gap-1 text-xs">
              <Paperclip aria-hidden className="size-3" />
              <span className="tabular-nums">
                {t("socialPost.attachments", { count: item.attachmentCount })}
              </span>
            </span>
          ) : null}
        </div>
      </div>
      {item.previewMedia ? (
        <span className="shrink-0 max-sm:hidden">
          <CompactSocialPostThumb
            className="size-12"
            media={item.previewMedia}
          />
        </span>
      ) : null}
      {isChangeableSocialPost(item) ? (
        <Button
          aria-label={t("list.reschedule", { time })}
          className="relative z-10 size-10 shrink-0 md:size-8"
          onClick={() => onReschedule(item)}
          size="icon"
          title={t("list.rescheduleHint")}
          type="button"
          variant="ghost"
        >
          <CalendarClock aria-hidden />
        </Button>
      ) : null}
    </li>
  );
}
