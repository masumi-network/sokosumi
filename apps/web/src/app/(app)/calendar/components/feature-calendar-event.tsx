"use client";

import type {
  ContactFollowUpCalendarItem,
  MarketingPieceCalendarItem,
  NewsletterIssueCalendarItem,
  SokoBotRunCalendarItem,
  WorkspaceCalendarSource,
} from "@sokosumi/core-client";
import {
  CalendarClock,
  Ellipsis,
  FileText,
  type LucideIcon,
  Mail,
  Users,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { calendarTypeOf } from "@/app/calendar/calendar-types";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sokoBotConsoleRoute } from "@/lib/soko-bot/constants";
import { cn } from "@/lib/utils";
import { SourceMarker } from "./source-marker";

/** The entries of features that open elsewhere and move nowhere. */
export type FeatureCalendarEntry =
  | NewsletterIssueCalendarItem
  | ContactFollowUpCalendarItem
  | MarketingPieceCalendarItem
  | SokoBotRunCalendarItem;

/** The card every Calendar entry is drawn on; `interactive` adds hover and focus. */
export function calendarCardClassName(interactive: boolean): string {
  return cn(
    "bg-background text-foreground border border-border flex w-full min-w-0 select-none flex-col items-start gap-0.5 overflow-hidden rounded px-1.5 py-1 text-left text-xs font-medium",
    interactive &&
      "hover:bg-muted focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring cursor-pointer outline-none focus-visible:ring-2 motion-safe:transition-colors motion-safe:duration-150 motion-safe:ease-out",
  );
}

/** A Soko Bot run's state, said on its card; a run still to come says nothing. */
type BotRunStateLabel = (state: "running" | "done" | "failed") => string;

/** What each kind shows and where it opens: the one place to add a feature. */
function featureEventView(
  item: FeatureCalendarEntry,
  botRunState?: BotRunStateLabel,
): {
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
        href: newsletterHref(
          `/newsletter/issues/${encodeURIComponent(item.issueId)}`,
          item.sourceProjectId,
        ),
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
    case "sokoBotRun":
      return {
        Icon: CalendarClock,
        title: item.name,
        // A shared bot names itself: a workspace may hold several.
        detail:
          [
            item.shared ? item.botName : null,
            item.runState !== "upcoming" && botRunState
              ? botRunState(item.runState)
              : null,
          ]
            .filter(Boolean)
            .join(" · ") || null,
        href: `${sokoBotConsoleRoute(item.shared ? item.sokoBotId : null)}?schedule=${encodeURIComponent(item.scheduleId)}`,
        project: item.projectName,
        allDay: false,
        start: item.scheduledAt.toISOString(),
      };
  }
}

/** What FullCalendar needs to place an entry. */
export function featureEntryPlacement(item: FeatureCalendarEntry) {
  const { title, allDay, start } = featureEventView(item);
  return { title, allDay, start };
}

/** The Soko Bot's next run, which the viewer may move or skip. */
export type ChangeableBotRun = SokoBotRunCalendarItem & { canChange: true };

export function isChangeableBotRun(
  item: FeatureCalendarEntry,
): item is ChangeableBotRun {
  return item.kind === "sokoBotRun" && item.canChange;
}

export interface BotRunHandlers {
  onMoveBotRun: (item: ChangeableBotRun) => void;
  onRestoreBotRun: (item: ChangeableBotRun) => void;
  onSkipBotRun: (item: ChangeableBotRun) => void;
}

/** A Newsletter issue, Contact follow-up, Marketing piece or Soko Bot run: title and time. */
export function FeatureCalendarEvent({
  item,
  source,
  timeText,
  onMoveBotRun,
  onRestoreBotRun,
  onSkipBotRun,
}: Partial<BotRunHandlers> & {
  item: FeatureCalendarEntry;
  source: WorkspaceCalendarSource | undefined;
  timeText: string | undefined;
}) {
  const t = useTranslations("App.Calendar");
  const [menuOpen, setMenuOpen] = useState(false);
  const { Icon, title, detail, href, project, allDay } = featureEventView(
    item,
    (state) => t(`botRun.${state}`),
  );
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
  // A run still to come opens a menu, as a Task Schedule Run does: move,
  // skip, restore a moved one, or open its schedule. The card is not the
  // trigger, so a tap opens it too.
  if (
    href &&
    isChangeableBotRun(item) &&
    onMoveBotRun &&
    onRestoreBotRun &&
    onSkipBotRun
  ) {
    return (
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <div
          className={calendarCardClassName(true)}
          data-testid="calendar-event"
          onClick={() => setMenuOpen(true)}
        >
          {content}
          <DropdownMenuTrigger asChild>
            <button
              aria-label={accessibleName}
              className="text-muted-foreground press hover:bg-muted hover:text-foreground focus-visible:ring-ring focus-visible:inset-ring-1 focus-visible:inset-ring-ring ml-auto flex size-5 shrink-0 cursor-pointer items-center justify-center rounded outline-none focus-visible:ring-2"
              onClick={(event) => event.stopPropagation()}
              type="button"
            >
              <Ellipsis aria-hidden className="size-4" />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onMoveBotRun(item)}>
            {t("event.moveRun")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onSkipBotRun(item)}>
            {t("event.skipRun")}
          </DropdownMenuItem>
          {item.originalAt.getTime() !== item.scheduledAt.getTime() ? (
            <DropdownMenuItem onSelect={() => onRestoreBotRun(item)}>
              {t("event.restoreRun")}
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem asChild>
            <Link href={href}>{t("event.openSchedule")}</Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }
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
