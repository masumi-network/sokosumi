"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { useMemo, useState } from "react";

import { formatDay, planWeeks } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { StrategyReveal } from "../strategy-reveal";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

/**
 * The plan fast-forwarded, then the four weeks piece by piece; every piece
 * opens with its full text.
 */
export function StrategyPage({
  overview,
  onAsk,
}: {
  overview: CmoOverview;
  onAsk: (text: string) => Promise<void>;
}) {
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
  const live = strategy.calendar.filter((entry) => entry.status !== "skipped");
  const byDay = (day: string) =>
    live
      .filter((entry) => entry.date === day)
      .sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));

  return (
    <div className="plan">
      <StrategyReveal
        overview={overview}
        onAsk={onAsk}
        calendar={
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
                            <span className="plan-item-title">
                              {entry.title}
                            </span>
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
        }
      />

      <AnimatePresence>
        {open ? (
          <EntrySheet entry={open} onClose={() => setOpen(null)} />
        ) : null}
      </AnimatePresence>
    </div>
  );
}
