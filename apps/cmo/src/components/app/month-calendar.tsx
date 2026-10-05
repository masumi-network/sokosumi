import type { CmoOverview } from "@sokosumi/core-client";

import { calendarKind, entryReadiness, monthGrid } from "../../lib/calendar";

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

export function MonthCalendar({
  strategy,
  big = false,
  connected = [],
}: MonthCalendarProps) {
  const cells = monthGrid(strategy.month, strategy.calendar);
  return (
    <div className={big ? "cal big" : "cal"}>
      {WEEKDAYS.map((day, index) => (
        <span key={index} className="dow">
          {day}
        </span>
      ))}
      {cells.map((cell, index) =>
        cell.date ? (
          <span key={cell.date} className="d">
            {big ? <span className="n">{cell.day}</span> : null}
            {cell.entries.map((entry) =>
              big ? (
                <span key={entry.id} className="entry-chip" title={entry.title}>
                  <i className={`k ${calendarKind(entry)}`} />
                  <span>
                    {entry.title}
                    {READINESS_NOTES[
                      entryReadiness(entry.channel, connected)
                    ] ? (
                      <span className="note">
                        {" "}
                        ·{" "}
                        {
                          READINESS_NOTES[
                            entryReadiness(entry.channel, connected)
                          ]
                        }
                      </span>
                    ) : null}
                  </span>
                </span>
              ) : (
                <i
                  key={entry.id}
                  className={`k ${calendarKind(entry)}`}
                  title={entry.title}
                />
              ),
            )}
          </span>
        ) : (
          <span key={`blank-${index}`} className="d blank" />
        ),
      )}
    </div>
  );
}
