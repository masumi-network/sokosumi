"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, useTransition } from "react";

import { formatDay, planWeeks } from "../../lib/calendar";
import { changeIdeas } from "../../lib/change-ideas";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { withoutLabel } from "../showcases";
import { outcomeLine, StrategyReveal } from "../strategy-reveal";
import { Refusal } from "./refusal";
import { StepHead } from "./step-head";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

interface StrategyStepProps {
  overview: CmoOverview;
  onChange: (note: string) => Promise<string | null>;
  /** The owner's own monthly ad budget; a refusal comes back as text. */
  onSetAds: (monthly: number, currency: string) => Promise<string | null>;
  onApprove: () => Promise<void>;
  /** Set when the founder opened the approved plan again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
}

/**
 * The strategy, so a founder can decide to hire Cuso from it: the why, every
 * day of the next four weeks, and what their accounts will look like. While
 * Cuso writes or changes it, the plan stays on screen and fills in.
 */
export function StrategyStep({
  overview,
  onChange,
  onSetAds,
  onApprove,
  ahead,
}: StrategyStepProps) {
  const strategy = overview.strategy as Strategy;
  const weeks = useMemo(
    () => planWeeks(strategy.calendar),
    [strategy.calendar],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, Entry[]>();
    for (const entry of [...strategy.calendar].sort((a, b) =>
      (a.time ?? "").localeCompare(b.time ?? ""),
    )) {
      map.set(entry.date, [...(map.get(entry.date) ?? []), entry]);
    }
    return map;
  }, [strategy.calendar]);
  const [open, setOpen] = useState<Entry | null>(null);
  const [note, setNote] = useState("");
  const [asked, setAsked] = useState<string | null>(null);
  const [changing, startChanging] = useTransition();
  const [approving, startApproving] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const work = overview.work;
  const writing = work?.kind === "strategy" && work.status === "running";
  const pieces = strategy.calendar.length;
  // The plan arrives in one save; only a change can stop half way.
  const stopped =
    work?.kind === "strategy" && work.status === "failed" && asked !== null;
  const busy = writing || changing;
  const changes = strategy.changes ?? [];
  const goal = lowerFirst(outcomeLine(strategy)) || "your goal";

  function requestChange(text: string) {
    const request = text.trim();
    if (!request) return;
    startChanging(async () => {
      const refused = await onChange(request);
      setRefusal(refused);
      if (!refused) {
        setAsked(request);
        setNote("");
      }
    });
  }

  return (
    <section className="ob-strategy">
      <StepHead
        step={4}
        title="Strategy"
        mood="point"
        busy={writing || changing}
        say={
          writing
            ? asked
              ? `I'm changing your plan: “${asked}”. About two minutes.`
              : "I'm finishing your plan."
            : ahead
              ? "Your approved plan. Ask for a change and I send it back for your OK."
              : `Your next four weeks: ${pieces} pieces to get ${goal}. Ask for changes, then approve it.`
        }
        note={
          ahead || writing
            ? undefined
            : "Nothing goes out until you approve. No charge yet."
        }
        action={
          ahead ? (
            <button
              type="button"
              className="ob-button ob-button-lg"
              onClick={ahead.onClick}
            >
              Continue to {ahead.label}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className="ob-button ob-button-lg"
              disabled={approving || busy}
              onClick={() => startApproving(onApprove)}
            >
              {approving ? (
                "Approving…"
              ) : writing ? (
                <>
                  <Loader2 size={16} className="ob-spin" aria-hidden="true" />
                  {asked ? "Cuso is changing it" : "Cuso is finishing"}
                </>
              ) : (
                <>
                  <Check size={16} aria-hidden="true" />
                  Approve plan
                </>
              )}
            </button>
          )
        }
      />
      {stopped ? (
        <p className="ob-alert" role="alert">
          {asked
            ? "That change didn't go through. Ask again below."
            : "Cuso stopped before he finished. Ask him below to finish the plan."}
        </p>
      ) : null}

      {changes.length > 0 && !writing ? (
        <motion.div
          className="ob-changed"
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <p className="ob-label">
            <Wand2 size={14} aria-hidden="true" /> What changed
          </p>
          <ul className="ob-list">
            {changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </motion.div>
      ) : null}

      <StrategyReveal
        overview={overview}
        intro={!ahead}
        onAsk={async (text) => {
          const refused = await onChange(text);
          setRefusal(refused);
          if (refused) throw new Error(refused);
          setAsked(text);
        }}
        onSetAds={async (monthly, currency) => {
          const refused = await onSetAds(monthly, currency);
          setRefusal(refused);
          if (refused) throw new Error(refused);
          setAsked(`Ad budget: ${currency} ${monthly} a month`);
        }}
        calendar={
          <div className="ob-weeks">
            <div className="ob-weekdays" aria-hidden="true">
              {WEEKDAYS.map((day) => (
                <span key={day}>{day}</span>
              ))}
            </div>
            {weeks.map((week, weekIndex) => (
              <div key={week.start} className="ob-week">
                <span className="ob-week-label">Week {weekIndex + 1}</span>
                <div className="ob-days">
                  {week.days.map((day) => {
                    const entries = byDay.get(day) ?? [];
                    const dayNumber = formatDay(day, { day: "numeric" });
                    return (
                      <div
                        key={day}
                        className={
                          entries.length ? "ob-day" : "ob-day ob-day-blank"
                        }
                      >
                        <span className="ob-day-n">
                          <span className="ob-day-short">
                            {dayNumber}
                            {dayNumber === "1"
                              ? ` ${formatDay(day, { month: "short" })}`
                              : ""}
                          </span>
                          <span className="ob-day-long">
                            {formatDay(day, {
                              weekday: "short",
                              day: "numeric",
                              month: "short",
                            })}
                          </span>
                        </span>
                        {entries.map((entry) => (
                          <button
                            key={entry.id}
                            type="button"
                            className="ob-entry"
                            onClick={() => setOpen(entry)}
                          >
                            <span className="ob-entry-meta">
                              <ChannelIcon channel={entry.channel} size={12} />
                              {entry.time ?? ""}
                              {entry.draft ? (
                                <Check
                                  size={11}
                                  className="ob-entry-written"
                                  aria-label="Written"
                                />
                              ) : null}
                            </span>
                            <span className="ob-entry-title">
                              {withoutLabel(entry.hook ?? entry.title)}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        }
      />

      <form
        className="ob-change"
        onSubmit={(event) => {
          event.preventDefault();
          requestChange(note);
        }}
      >
        <p className="ob-label">
          <Wand2 size={14} aria-hidden="true" /> Want something different?
        </p>
        <div className="ob-change-row">
          <input
            ref={input}
            className="ob-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. “Add a weekly customer story”"
            aria-label="What should Cuso change?"
            disabled={busy}
          />
          <button
            type="submit"
            className="ob-button ob-button-quiet"
            disabled={busy || !note.trim()}
          >
            {changing ? (
              <Loader2 size={14} className="ob-spin" aria-hidden="true" />
            ) : null}
            Change it
          </button>
        </div>
        <div className="ob-chips">
          {changeIdeas(overview).map((idea) => (
            <button
              key={idea}
              type="button"
              className="ob-chip ob-chip-button"
              disabled={busy}
              onClick={() => {
                setNote(idea);
                input.current?.focus();
              }}
            >
              {idea}
            </button>
          ))}
        </div>
        {refusal ? (
          <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
        ) : null}
      </form>

      <AnimatePresence>
        {open ? (
          <EntrySheet
            entry={open}
            media={overview.media.find((item) => item.entryId === open.id)}
            onClose={() => setOpen(null)}
          />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function lowerFirst(text: string): string {
  return `${text.charAt(0).toLowerCase()}${text.slice(1)}`;
}
