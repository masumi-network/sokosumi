"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";

import {
  channelLabel,
  entryReadiness,
  formatDay,
  planRange,
  planWeeks,
} from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const READINESS = {
  ready: { label: "Posting", className: "tag ok" },
  connect: { label: "Connect to post", className: "tag warn" },
  soon: { label: "Drafts only", className: "tag" },
} as const;

/**
 * The plan in one read: what it is for, the four weeks piece by piece, and
 * where it runs. The reasoning sits behind "Why this plan"; every piece
 * opens with its full text.
 */
export function StrategyPage({ overview }: { overview: CmoOverview }) {
  const strategy = overview.strategy;
  const [open, setOpen] = useState<Entry | null>(null);
  const weeks = useMemo(
    () => (strategy ? planWeeks(strategy.calendar) : []),
    [strategy],
  );
  if (!strategy) {
    return (
      <div className="empty">
        <span className="shape" aria-hidden="true" />
        <span>Cuso is still writing the strategy.</span>
      </div>
    );
  }
  const connected = overview.channels
    .filter((channel) => channel.status.toUpperCase() === "ACTIVE")
    .map((channel) => channel.provider.toLowerCase());
  const live = strategy.calendar.filter((entry) => entry.status !== "skipped");
  const byDay = (day: string) =>
    live
      .filter((entry) => entry.date === day)
      .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const range = planRange(strategy.calendar);

  return (
    <div className="plan">
      <header className="plan-head">
        <p className="note">
          {[
            range,
            `${live.length} pieces`,
            `${strategy.channels.length} channels`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        <h1 className="plan-title">{strategy.summary}</h1>
      </header>

      <div className="plan-facts">
        <Fact label="Goal" lines={strategy.goals.slice(0, 1)} />
        {strategy.audience ? (
          <Fact label="Who it's for" lines={[strategy.audience]} />
        ) : null}
        {strategy.positioning ? (
          <Fact label="The angle" lines={[strategy.positioning]} />
        ) : null}
      </div>

      <section className="plan-section">
        <h2>Week by week</h2>
        <div className="plan-weeks">
          {weeks.map((week, index) => {
            const items = week.days.flatMap(byDay);
            return (
              <div key={week.start} className="plan-week">
                <p className="plan-week-head">
                  <b>Week {index + 1}</b>
                  <span className="note num">
                    {formatDay(week.days[0] ?? week.start, {
                      day: "numeric",
                      month: "short",
                    })}
                  </span>
                </p>
                {items.length === 0 ? (
                  <p className="note">Nothing planned.</p>
                ) : (
                  <ul className="plan-items">
                    {items.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          className={
                            entry.status === "published"
                              ? "plan-item done"
                              : "plan-item"
                          }
                          onClick={() => setOpen(entry)}
                        >
                          <span className="plan-day num">
                            {formatDay(entry.date, {
                              weekday: "short",
                              day: "numeric",
                            })}
                          </span>
                          <ChannelIcon channel={entry.channel} size={14} />
                          <span className="plan-item-title">{entry.title}</span>
                          {entry.status === "published" ? (
                            <Check
                              size={13}
                              className="plan-done"
                              aria-label="Published"
                            />
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="plan-section">
        <h2>Channels</h2>
        <ul className="plan-channels">
          {strategy.channels.map((channel) => {
            const readiness =
              READINESS[entryReadiness(channel.channel, connected)];
            const count = live.filter(
              (entry) => entry.channel === channel.channel,
            ).length;
            return (
              <li key={channel.channel}>
                <ChannelIcon channel={channel.channel} size={18} />
                <b>{channelLabel(channel.channel)}</b>
                <span className="note plan-cadence">{channel.cadence}</span>
                <span className="note num">
                  {count} {count === 1 ? "piece" : "pieces"}
                </span>
                <span className={readiness.className}>{readiness.label}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {strategy.why ||
      strategy.goals.length > 1 ||
      strategy.pillars.length > 0 ? (
        <details className="plan-why">
          <summary>Why this plan</summary>
          {strategy.why ? <p>{strategy.why}</p> : null}
          {strategy.goals.length > 1 ? (
            <ul className="plan-goals">
              {strategy.goals.slice(1).map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          ) : null}
          {strategy.pillars.length > 0 ? (
            <p className="plan-pillars">
              {strategy.pillars.map((pillar) => (
                <span key={pillar} className="tag">
                  {pillar}
                </span>
              ))}
            </p>
          ) : null}
        </details>
      ) : null}

      <AnimatePresence>
        {open ? (
          <EntrySheet entry={open} onClose={() => setOpen(null)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** A fact in a line or two; the full text is one hover away. */
function Fact({ label, lines }: { label: string; lines: string[] }) {
  return (
    <div className="plan-fact">
      <span className="label">{label}</span>
      {lines.map((line) => (
        <p key={line} title={line}>
          {line}
        </p>
      ))}
    </div>
  );
}
