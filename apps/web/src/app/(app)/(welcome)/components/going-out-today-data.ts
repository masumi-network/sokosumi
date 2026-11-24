import "server-only";

import type {
  NewsletterIssueCalendarItem,
  SocialPostCalendarItem,
  TaskStatus,
  WorkspaceCalendarEntry,
} from "@sokosumi/core-client";
import { unstable_rethrow } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import {
  availableCalendarTypes,
  type CalendarType,
  calendarTypesQuery,
} from "@/app/calendar/calendar-types";
import { calendarUrl } from "@/app/calendar/calendar-url";
import { newsletterHref } from "@/app/newsletter/newsletter-tabs";
import { taskSchedulePath } from "@/app/tasks/utils/task-schedule-view";
import { isNewsletterEnabled } from "@/lib/newsletter-access.server";
import { taskService } from "@/lib/services/task.service";

/** Rows Home shows; the Calendar holds the rest of the day. */
export const GOING_OUT_LIMIT = 5;

/**
 * What goes out on its own: Social posts, newsletter issues, scheduled runs.
 * Soko Bot runs stay out: Home already lists the bot's schedules.
 */
const GOING_OUT_TYPES: readonly CalendarType[] = [
  "tasks",
  "social",
  "newsletter",
];

/** One thing Home says goes out today, with the status its feature gave it. */
export type GoingOutRow = {
  id: string;
  at: Date;
  title: string;
  href: string;
} & (
  | { kind: "social"; status: SocialPostCalendarItem["status"] }
  | { kind: "newsletter"; status: NewsletterIssueCalendarItem["status"] }
  /** `PLANNED`: a Schedule's run with no Task yet. */
  | { kind: "task"; status: TaskStatus | "PLANNED" }
);

export interface GoingOutPage {
  rows: GoingOutRow[];
  /** Everything going out today, so Home can say how many the Calendar has. */
  total: number;
  /** The Calendar on the same day, scope and kinds as the list. */
  calendarHref: string;
}

/** A Calendar entry as a Going out today row; null for kinds it skips. */
export function goingOutRow(item: WorkspaceCalendarEntry): GoingOutRow | null {
  switch (item.kind) {
    case "socialPost":
      return {
        id: item.id,
        kind: "social",
        at: item.scheduledAt,
        title: item.text,
        status: item.status,
        href: `/social?${new URLSearchParams({ projectId: item.sourceProjectId, postId: item.postId })}`,
      };
    case "newsletterIssue":
      return {
        id: item.id,
        kind: "newsletter",
        at: item.scheduledAt,
        title: item.subject,
        status: item.status,
        href: newsletterHref(
          `/newsletter/issues/${encodeURIComponent(item.issueId)}`,
          item.sourceProjectId,
        ),
      };
    case "RUN":
    case "RUN_AT": {
      // A released run opens its Task; a planned one has only its Schedule.
      const href = item.taskId
        ? `/tasks/${encodeURIComponent(item.taskId)}`
        : item.scheduleId
          ? taskSchedulePath(item.scheduleId)
          : null;
      if (!href) return null;
      return {
        id: item.id,
        kind: "task",
        at: item.scheduledAt,
        title: item.taskName,
        status: item.taskStatus ?? "PLANNED",
        href,
      };
    }
    default:
      return null;
  }
}

/**
 * The first rows of what goes out on the reader's `today` (`YYYY-MM-DD` in
 * `timeZone`), read from the workspace Calendar. Null on failure.
 */
export async function loadGoingOutToday({
  today,
  timeZone,
  scope,
}: {
  today: string;
  timeZone: string;
  scope: "owned" | "workspace";
}): Promise<GoingOutPage | null> {
  try {
    // Each end is its own midnight: a day that skips or repeats an hour is
    // not 24 hours long.
    const day = Temporal.PlainDate.from(today);
    const startOf = (date: Temporal.PlainDate) =>
      new Date(date.toZonedDateTime(timeZone).epochMilliseconds);
    const available = availableCalendarTypes(await isNewsletterEnabled(), {
      scope,
    });
    const types = calendarTypesQuery(
      GOING_OUT_TYPES.filter((type) => available.includes(type)),
    );
    const { items, pagination } = await taskService.getWorkspaceCalendar({
      from: startOf(day),
      to: startOf(day.add({ days: 1 })),
      types,
      timeZone,
      scope,
      limit: GOING_OUT_LIMIT,
    });
    const rows = items.flatMap((item) => goingOutRow(item) ?? []);
    return {
      rows,
      total: pagination?.total ?? rows.length,
      calendarHref: calendarUrl({ date: today, view: "week", types, scope }),
    };
  } catch (error) {
    // A 401 redirects to sign-in; let it through.
    unstable_rethrow(error);
    console.warn("Going out today failed", { error });
    return null;
  }
}
