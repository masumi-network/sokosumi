"use client";

import type {
  ContactFollowUpCalendarItem,
  MarketingPieceCalendarItem,
  NewsletterIssueCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import { FileText, type LucideIcon, Mail, Users } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { calendarTypeOf } from "@/app/calendar/calendar-types";
import { cn } from "@/lib/utils";
import { SourceMarker } from "./source-marker";

/** The entries of features that open elsewhere and move nowhere. */
export type FeatureCalendarEntry =
  | NewsletterIssueCalendarItem
  | ContactFollowUpCalendarItem
  | MarketingPieceCalendarItem;

/** The card every Calendar entry is drawn on; `interactive` adds hover and focus. */
export function calendarCardClassName(interactive: boolean): string {
  return cn(
    "bg-background text-foreground border border-border flex w-full min-w-0 select-none flex-col items-start gap-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium",
    interactive &&
      "hover:bg-muted focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring cursor-pointer outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
  );
}

/** What each kind shows and where it opens: the one place to add a feature. */
function describe(item: FeatureCalendarEntry): {
  Icon: LucideIcon;
  title: string;
  detail: string | null;
  href: string | null;
  /** The Project it belongs to; none for a Workspace's own entries. */
  project: string | null;
  /** A day, not an instant: it sits on `start`, a date. */
  allDay: boolean;
  /** An ISO instant, or a date for an all-day entry. */
  start: string;
} {
  switch (item.kind) {
    case "newsletterIssue":
      return {
        Icon: Mail,
        title: item.subject,
        detail: null,
        href: `/newsletter/issues/${encodeURIComponent(item.issueId)}`,
        project: item.projectName,
        allDay: false,
        start: item.scheduledAt.toISOString(),
      };
    case "contactFollowUp":
      return {
        Icon: Users,
        title: item.name,
        detail: item.nextStep,
        href: `/contacts?contact=${encodeURIComponent(item.contactId)}`,
        project: null,
        allDay: true,
        start: item.date,
      };
    case "marketingPiece":
      return {
        Icon: FileText,
        title: item.title,
        detail: null,
        href: item.fileId
          ? `/drive/files/${encodeURIComponent(item.fileId)}`
          : null,
        project: item.projectName,
        allDay: false,
        start: item.scheduledAt.toISOString(),
      };
  }
}

/** What FullCalendar needs to place an entry. */
export function featureEntryPlacement(item: FeatureCalendarEntry) {
  const { title, allDay, start } = describe(item);
  return { title, allDay, start };
}

/** A Newsletter issue, Contact follow-up or Marketing piece: title and time. */
export function FeatureCalendarEvent({
  item,
  source,
  timeText,
}: {
  item: FeatureCalendarEntry;
  source: WorkspaceCalendarSource | undefined;
  timeText: string | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const { Icon, title, detail, href, project, allDay } = describe(item);
  const content = (
    <>
      <span className="flex w-full min-w-0 items-center gap-1">
        <Icon aria-hidden className="text-muted-foreground size-3 shrink-0" />
        <span className="text-muted-foreground shrink-0 tabular-nums">
          {allDay ? t("event.allDay") : timeText}
        </span>
        {project ? (
          <>
            <SourceMarker decorative source={source} sourceName={project} />
            <span className="text-muted-foreground min-w-0 flex-1 truncate">
              {project}
            </span>
          </>
        ) : null}
      </span>
      <span className="line-clamp-2 w-full min-w-0">{title}</span>
      {detail ? (
        <span className="text-muted-foreground w-full min-w-0 truncate">
          {detail}
        </span>
      ) : null}
    </>
  );

  const accessibleName = t("event.accessibleName", {
    source: t(`show.${calendarTypeOf(item)}`),
    task: title,
  });
  if (!href) {
    return (
      <div
        aria-label={accessibleName}
        className={calendarCardClassName(false)}
        data-testid="calendar-event"
        role="group"
      >
        {content}
      </div>
    );
  }
  return (
    <Link
      aria-label={accessibleName}
      className={calendarCardClassName(true)}
      data-testid="calendar-event"
      href={href}
    >
      {content}
    </Link>
  );
}
