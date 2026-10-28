"use client";

import type { NewsletterIssue } from "@sokosumi/core-client";
import { isValidTimezone } from "@sokosumi/utils";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { useQueryStates } from "nuqs";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { HOLDER_CLASS } from "@/components/ui/holder-surface";
import { useMountEffect } from "@/hooks/use-mount-effect";
import { getDefaultTimezone } from "@/lib/schedules/timezones";
import { cn } from "@/lib/utils";
import { newsletterHref } from "../newsletter-tabs";
import { dateKey, getMonthGridDays, shiftMonth } from "./month";
import { calendarSearchParams } from "./search-params";

export function NewsletterCalendar({
  projectId,
  month,
  timeZone,
  today,
  issues,
}: {
  projectId: string;
  /** `YYYY-MM` */
  month: string;
  timeZone: string;
  /** `YYYY-MM-DD` in `timeZone` */
  today: string;
  issues: NewsletterIssue[];
}) {
  const t = useTranslations("App.Projects.Newsletter");
  const format = useFormatter();
  const [query, setQuery] = useQueryStates(calendarSearchParams, {
    shallow: false,
  });
  useMountEffect(() => {
    if (!isValidTimezone(query.timezone)) {
      void setQuery({ timezone: getDefaultTimezone() });
    }
  });

  const href = (target: string | null) => {
    const search = new URLSearchParams({
      ...(target ? { month: target } : {}),
      timezone: timeZone,
    });
    return `${newsletterHref("/newsletter/calendar", projectId)}&${search}`;
  };
  const days = getMonthGridDays(month);
  const byDay = new Map<string, { issue: NewsletterIssue; at: Date }[]>();
  for (const issue of issues) {
    const at = issue.scheduledAt ?? issue.sentAt;
    if (!at) continue;
    const key = dateKey(at, timeZone);
    byDay.set(key, [...(byDay.get(key) ?? []), { issue, at }]);
  }
  for (const entries of byDay.values())
    entries.sort((a, b) => a.at.getTime() - b.at.getTime());
  const utcDate = (day: string) => new Date(`${day}T12:00:00Z`);
  const monthLabel = format.dateTime(utcDate(`${month}-01`), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const hasIssues = days.some((day) => byDay.has(day));

  return (
    <section className="min-w-0 space-y-4" aria-labelledby="newsletter-month">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="newsletter-month" className="text-base font-semibold">
          {monthLabel}
        </h3>
        <nav aria-label={t("Calendar.navigation")} className="flex gap-2">
          <Button asChild variant="outline" size="icon">
            <Link
              href={href(shiftMonth(month, -1))}
              aria-label={t("Calendar.previous")}
            >
              <ChevronLeft aria-hidden />
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={href(null)}>{t("Calendar.today")}</Link>
          </Button>
          <Button asChild variant="outline" size="icon">
            <Link
              href={href(shiftMonth(month, 1))}
              aria-label={t("Calendar.next")}
            >
              <ChevronRight aria-hidden />
            </Link>
          </Button>
        </nav>
      </div>
      {!hasIssues ? (
        <div className={HOLDER_CLASS}>
          <EmptyState
            icon={CalendarDays}
            title={t("Calendar.emptyTitle")}
            description={t("Calendar.emptyDescription")}
            action={
              <Button asChild variant="outline">
                <Link href={newsletterHref("/newsletter/issues", projectId)}>
                  {t("Calendar.viewIssues")}
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className={cn(HOLDER_CLASS, "min-w-0")}>
          <div className="bg-background border-border min-w-0 overflow-hidden rounded-lg border">
            <div
              aria-hidden
              className="bg-quinary text-muted-foreground hidden grid-cols-7 border-b text-xs font-medium sm:grid"
            >
              {days.slice(0, 7).map((day) => (
                <div key={day} className="px-2 py-1.5">
                  {format.dateTime(utcDate(day), {
                    weekday: "short",
                    timeZone: "UTC",
                  })}
                </div>
              ))}
            </div>
            <ol className="grid grid-cols-1 sm:grid-cols-7">
              {days.map((day) => {
                const dayIssues = byDay.get(day) ?? [];
                const outside = !day.startsWith(month);
                return (
                  <li
                    key={day}
                    data-testid={`newsletter-calendar-day-${day}`}
                    aria-current={day === today ? "date" : undefined}
                    className={cn(
                      "border-border min-w-0 space-y-1 border-b p-1.5 sm:min-h-28 sm:border-r sm:[&:nth-child(7n)]:border-r-0",
                      outside && "bg-quinary text-muted-foreground",
                      !dayIssues.length && "hidden sm:block",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs tabular-nums",
                        day === today &&
                          "bg-primary-solid text-primary-solid-foreground font-semibold",
                      )}
                    >
                      <span className="sm:hidden">
                        {format.dateTime(utcDate(day), {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          timeZone: "UTC",
                        })}
                      </span>
                      <span className="hidden sm:inline">
                        {Number(day.slice(8))}
                      </span>
                    </span>
                    {dayIssues.length ? (
                      <ul className="space-y-1">
                        {dayIssues.map(({ issue, at }) => (
                          <li key={issue.id}>
                            <Link
                              href={newsletterHref(
                                `/newsletter/issues/${encodeURIComponent(issue.id)}`,
                                projectId,
                              )}
                              className="bg-background text-foreground hover:bg-muted border-border focus-visible:ring-ring-halo block min-w-0 rounded border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
                            >
                              <span className="text-muted-foreground block tabular-nums">
                                {format.dateTime(at, "time", {
                                  timeZone,
                                })}
                              </span>
                              <span
                                className="block truncate font-medium"
                                title={issue.subject}
                              >
                                {issue.subject}
                              </span>
                              <span className="text-muted-foreground block">
                                {t(`Issues.statuses.${issue.status}`)}
                              </span>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
