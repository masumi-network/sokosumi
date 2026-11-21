import type { CmoOverview } from "@sokosumi/core-client";

import { calendarKind, planWeeks } from "../../lib/calendar";

type Strategy = NonNullable<CmoOverview["strategy"]>;

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

export function CalendarLegend() {
  return (
    <div className="plan-legend">
      <span>
        <i className="kind-mark kind-post" />
        Post
      </span>
      <span>
        <i className="kind-mark kind-ad" />
        Ad
      </span>
      <span>
        <i className="kind-mark kind-article" />
        SEO article
      </span>
      <span>
        <i className="kind-mark kind-news" />
        Newsletter
      </span>
    </div>
  );
}

/**
 * The plan's weeks, Monday first, from its first day to its last: a mark a
 * piece. Its classes are its own, so the Calendar page's `.cal` and the post
 * preview's `.post` never reach it.
 */
export function MonthCalendar({ strategy }: { strategy: Strategy }) {
  const days = planWeeks(strategy.calendar).flatMap((week) => week.days);
  return (
    <div className="mini-cal">
      {WEEKDAYS.map((day, index) => (
        <span key={index} className="mini-cal-dow">
          {day}
        </span>
      ))}
      {days.map((date) => {
        const entries = strategy.calendar.filter(
          (entry) => entry.date === date,
        );
        return (
          <span
            key={date}
            className={entries.length ? "mini-cal-day" : "mini-cal-day blank"}
          >
            {entries.map((entry) => (
              <i
                key={entry.id}
                className={`kind-mark kind-${calendarKind(entry)}`}
                title={entry.title}
              />
            ))}
          </span>
        );
      })}
    </div>
  );
}
