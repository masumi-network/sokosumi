import type { NewsletterIssue } from "@sokosumi/core-client";
import { CalendarDays } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { calendarUrl } from "@/app/calendar/calendar-url";
import { EmptyState } from "@/components/common/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  HOLDER_CLASS,
  HOLDER_ITEM_CLASS,
  HOLDER_ITEM_HOVER_CLASS,
} from "@/components/ui/holder-surface";
import { cn } from "@/lib/utils";
import { IssueStatusBadge, IssueWhen } from "../issues/issue-delivery-status";
import { newsletterHref } from "../newsletter-tabs";

type Group = "scheduled" | "unscheduled" | "sent";

/** The date an issue sits on: its send, its schedule, or its last edit. */
function issueDate(issue: NewsletterIssue): Date {
  return issue.sentAt ?? issue.scheduledAt ?? issue.updatedAt;
}

/**
 * Scheduled issues soonest first, then the ones not yet scheduled and the
 * sent ones, newest first. Empty groups are left out.
 */
export function groupIssuesByDate(
  issues: readonly NewsletterIssue[],
): { group: Group; issues: NewsletterIssue[] }[] {
  const time = (issue: NewsletterIssue) => issueDate(issue).getTime();
  const pick = (group: Group) =>
    issues.filter((issue) =>
      issue.status === "SENT"
        ? group === "sent"
        : issue.status === "SCHEDULED" || issue.status === "SENDING"
          ? group === "scheduled"
          : group === "unscheduled",
    );
  return [
    {
      group: "scheduled" as const,
      issues: pick("scheduled").sort((a, b) => time(a) - time(b)),
    },
    {
      group: "unscheduled" as const,
      issues: pick("unscheduled").sort((a, b) => time(b) - time(a)),
    },
    {
      group: "sent" as const,
      issues: pick("sent").sort((a, b) => time(b) - time(a)),
    },
  ].filter(({ issues }) => issues.length);
}

/**
 * The Calendar tab: this newsletter's issues by date and status, inside the
 * newsletter, with the next issue up top and a way to the full Calendar.
 */
export function NewsletterCalendar({
  projectId,
  issues,
  total,
}: {
  projectId: string;
  issues: readonly NewsletterIssue[];
  /** Every issue; more than `issues` when only the newest page was loaded. */
  total: number;
}) {
  const t = useTranslations("App.Projects.Newsletter.Calendar");
  const format = useFormatter();
  const groups = groupIssuesByDate(issues);
  const next = groups.find(({ group }) => group === "scheduled")?.issues[0];
  const fullCalendar = (
    <Button asChild variant="outline">
      <Link href={calendarUrl({ types: "newsletter", projectId })}>
        <CalendarDays />
        {t("openFullCalendar")}
      </Link>
    </Button>
  );

  if (!issues.length) {
    return (
      <div className={HOLDER_CLASS}>
        <EmptyState
          icon={CalendarDays}
          title={t("emptyTitle")}
          description={t("emptyDescription")}
          action={
            <Button asChild variant="outline">
              <Link href={newsletterHref("/newsletter/issues", projectId)}>
                {t("goToIssues")}
              </Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <section
          aria-labelledby="newsletter-next-issue"
          className={cn(HOLDER_ITEM_CLASS, "min-w-0 space-y-1 p-4 sm:min-w-72")}
        >
          <h2
            id="newsletter-next-issue"
            className="text-muted-foreground text-sm"
          >
            {t("nextIssue")}
          </h2>
          {next ? (
            <>
              <p className="text-lg font-semibold">
                {format.dateTime(issueDate(next), {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  timeZone: next.timezone ?? "UTC",
                })}
              </p>
              <p className="text-muted-foreground text-sm wrap-anywhere">
                <Link
                  href={issueHref(projectId, next)}
                  className="text-foreground underline underline-offset-4"
                >
                  {next.subject}
                </Link>
                {" · "}
                {format.dateTime(issueDate(next), "time", {
                  timeZone: next.timezone ?? "UTC",
                })}
              </p>
            </>
          ) : (
            <p className="text-sm">{t("nothingScheduled")}</p>
          )}
        </section>
        {fullCalendar}
      </div>
      {groups.map(({ group, issues }) => (
        <section
          key={group}
          aria-labelledby={`newsletter-calendar-${group}`}
          className={cn(HOLDER_CLASS, "min-w-0 space-y-2")}
        >
          <div className="flex items-center gap-2 px-2 pt-1">
            <h2
              id={`newsletter-calendar-${group}`}
              className="text-base font-semibold"
            >
              {t(`groups.${group}`)}
            </h2>
            <Badge variant="secondary" className="tabular-nums">
              {t("count", { count: issues.length })}
            </Badge>
          </div>
          <ul className="min-w-0 space-y-2">
            {issues.map((issue) => {
              const date = issueDate(issue);
              // A schedule reads in its own zone, as on Issues.
              const timeZone =
                !issue.sentAt && issue.scheduledAt
                  ? (issue.timezone ?? "UTC")
                  : undefined;
              return (
                <li key={issue.id}>
                  <Link
                    href={issueHref(projectId, issue)}
                    className={cn(
                      HOLDER_ITEM_CLASS,
                      HOLDER_ITEM_HOVER_CLASS,
                      "focus-visible:ring-ring flex min-w-0 items-start gap-4 p-4 outline-none focus-visible:ring-2",
                    )}
                  >
                    <time
                      dateTime={date.toISOString()}
                      className="flex w-10 shrink-0 flex-col items-center"
                    >
                      <span className="text-muted-foreground text-xs">
                        {format.dateTime(date, { weekday: "short", timeZone })}
                      </span>
                      <span className="text-lg font-semibold tabular-nums">
                        {format.dateTime(date, { day: "numeric", timeZone })}
                      </span>
                      <span className="text-muted-foreground text-xs">
                        {format.dateTime(date, { month: "short", timeZone })}
                      </span>
                    </time>
                    <div className="min-w-0 space-y-1">
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="font-medium wrap-anywhere">
                          {issue.subject}
                        </span>
                        <IssueStatusBadge issue={issue} />
                      </div>
                      <IssueWhen issue={issue} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {total > issues.length ? (
        <p className="text-muted-foreground text-sm">
          {t("newestOnly", { count: issues.length })}
        </p>
      ) : null}
    </div>
  );
}

function issueHref(projectId: string, issue: NewsletterIssue) {
  return newsletterHref(
    `/newsletter/issues/${encodeURIComponent(issue.id)}`,
    projectId,
  );
}
