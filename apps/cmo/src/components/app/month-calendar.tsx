import type { CmoOverview } from "@sokosumi/core-client";

import {
  calendarKind,
  entryReadiness,
  formatDay,
  planWeeks,
} from "../../lib/calendar";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

interface MonthCalendarProps {
  strategy: Strategy;
  /** Full page: day numbers and titles; chat card: markers only. */
  big?: boolean;
  /** Providers with an active account; other entries are marked. */
  connected?: readonly string[];
}

const READINESS_NOTES = {
  ready: null,
  connect: "connect to run",
  soon: "coming soon",
} as const;

export function CalendarLegend() {
  return (
    <div className="legend">
      <span>
        <i className="k post" />
        Post
      </span>
      <span>
        <i className="k ad" />
        Ad
      </span>
      <span>
        <i className="k article" />
        SEO article
      </span>
      <span>
        <i className="k news" />
        Newsletter
      </span>
    </div>
  );
}

/** The plan's weeks, Monday first, from its first day to its last. */
export function MonthCalendar({
  strategy,
  big = false,
  connected = [],
}: MonthCalendarProps) {
  const days = planWeeks(strategy.calendar).flatMap((week) => week.days);
  return (
    <div className={big ? "cal big" : "cal"}>
      {WEEKDAYS.map((day, index) => (
        <span key={index} className="dow">
          {day}
        </span>
      ))}
      {days.map((date, index) => {
        const entries = strategy.calendar.filter(
          (entry) => entry.date === date,
        );
        const dayNumber = formatDay(date, { day: "numeric" });
        return (
          <span key={date} className={entries.length ? "d" : "d blank"}>
            {big ? (
              <span className="n">
                {dayNumber === "1" || index === 0
                  ? formatDay(date, { day: "numeric", month: "short" })
                  : dayNumber}
              </span>
            ) : null}
            {entries.map((entry) => {
              const note =
                READINESS_NOTES[entryReadiness(entry.channel, connected)];
              return big ? (
                <span key={entry.id} className="entry-chip" title={entry.title}>
                  <i className={`k ${calendarKind(entry)}`} />
                  <span>
                    {entry.title}
                    {note ? <span className="note"> · {note}</span> : null}
                  </span>
                </span>
              ) : (
                <i
                  key={entry.id}
                  className={`k ${calendarKind(entry)}`}
                  title={entry.title}
                />
              );
            })}
          </span>
        );
      })}
    </div>
  );
}
