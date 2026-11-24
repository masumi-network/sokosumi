import type {
  NewsletterIssueCalendarItem,
  SocialPostCalendarItem,
  TaskStatus,
  WorkspaceCalendarEntry,
} from "@sokosumi/core-client";
import { ListTodo, type LucideIcon, Mail, Share2 } from "lucide-react";
import Link from "next/link";
import { getFormatter, getTranslations } from "next-intl/server";
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

/** What goes out on its own: Social posts, newsletter issues, scheduled runs. */
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

const KIND_ICON: Record<GoingOutRow["kind"], LucideIcon> = {
  social: Share2,
  newsletter: Mail,
  task: ListTodo,
};

/** Statuses that mean it may not go out unless someone acts. */
const NEEDS_A_LOOK = new Set<GoingOutRow["status"]>([
  "NEEDS_APPROVAL",
  "FAILED",
  "MISSED",
]);

export interface GoingOutPage {
  rows: GoingOutRow[];
  /** Everything going out today, so Home can say how many the Calendar has. */
  total: number;
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
    const start = Temporal.PlainDate.from(today).toZonedDateTime(timeZone);
    const available = availableCalendarTypes(await isNewsletterEnabled(), {
      scope,
    });
    const { items, pagination } = await taskService.getWorkspaceCalendar({
      from: new Date(start.epochMilliseconds),
      to: new Date(start.add({ days: 1 }).epochMilliseconds),
      types: calendarTypesQuery(
        GOING_OUT_TYPES.filter((type) => available.includes(type)),
      ),
      timeZone,
      scope,
      limit: GOING_OUT_LIMIT,
    });
    const rows = items.flatMap((item) => goingOutRow(item) ?? []);
    return { rows, total: pagination?.total ?? rows.length };
  } catch (error) {
    console.warn("Going out today failed", { error });
    return null;
  }
}

/**
 * Home's "Going out today": the Social posts, newsletter issues and scheduled
 * Task runs set for the reader's day, each with its own status, so a post
 * waiting for approval never reads as going out for sure. Renders nothing on
 * a quiet day or a failed read.
 */
export async function GoingOutToday({
  feed,
  today,
}: {
  feed: Promise<GoingOutPage | null>;
  today: string;
}) {
  const [page, t, tSocial, tNewsletter, tTask, tCalendar, format] =
    await Promise.all([
      feed,
      getTranslations("App.Chat.Landing.GoingOut"),
      getTranslations("App.Projects.SocialPosts"),
      getTranslations("App.Projects.Newsletter.Issues"),
      getTranslations("App.Tasks.Filters"),
      getTranslations("App.Calendar.socialPost"),
      getFormatter(),
    ]);
  if (!page || page.rows.length === 0) return null;

  function statusLabel(row: GoingOutRow): string {
    switch (row.kind) {
      case "social":
        return tSocial(`status.${row.status}`);
      case "newsletter":
        return tNewsletter(`statuses.${row.status}`);
      case "task":
        return row.status === "PLANNED"
          ? t("planned")
          : tTask(`statusOptions.${row.status}`);
    }
  }

  return (
    <section aria-labelledby="home-going-out" data-testid="home-going-out">
      <div className="flex items-center justify-between gap-2 px-3 pb-2">
        <h2 id="home-going-out" className="text-foreground text-sm font-medium">
          {t("title")}
        </h2>
        <Link
          href={calendarUrl({ date: today, view: "week" })}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm text-sm outline-none focus-visible:ring-2"
        >
          {page.total > page.rows.length
            ? t("seeAllCount", { count: page.total })
            : t("seeAll")}
        </Link>
      </div>
      <ul className="flex flex-col">
        {page.rows.map((row) => {
          const Icon = KIND_ICON[row.kind];
          return (
            <li key={row.id} data-testid="home-going-out-row">
              <Link
                href={row.href}
                className="hover:bg-accent focus-visible:ring-ring grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-0.5 rounded-md px-3 py-2 outline-none transition-colors focus-visible:ring-2 sm:flex"
              >
                <Icon
                  aria-hidden
                  className="text-muted-foreground size-4 shrink-0"
                />
                <span className="text-foreground line-clamp-2 min-w-0 flex-1 text-sm break-words sm:line-clamp-1">
                  <span className="sr-only">{t(`kinds.${row.kind}`)}: </span>
                  {row.title.trim() || tCalendar("mediaOnly")}
                </span>
                <span className="col-start-2 flex shrink-0 items-center gap-2 text-sm">
                  <time
                    dateTime={row.at.toISOString()}
                    className="text-muted-foreground tabular-nums"
                  >
                    {format.dateTime(row.at, "time")}
                  </time>
                  <span
                    className={
                      NEEDS_A_LOOK.has(row.status)
                        ? "text-foreground font-medium"
                        : "text-muted-foreground"
                    }
                  >
                    {statusLabel(row)}
                  </span>
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
