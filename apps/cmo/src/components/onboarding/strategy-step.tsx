"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  Check,
  Clock,
  Lightbulb,
  Loader2,
  Sparkles,
  Target,
  Users,
  Wand2,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, useTransition } from "react";

import { channelLabel, SOCIAL_PROVIDERS } from "../../lib/calendar";
import { ChannelIcon } from "../channel-icon";
import { Clamp } from "./clamp";
import { Showcases } from "./showcases";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function utcDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Monday-first weeks from the first entry's week, at least four. */
export function planWeeks(
  calendar: Entry[],
): { start: string; days: string[] }[] {
  const dates = calendar.map((entry) => entry.date).sort();
  const first = dates[0] ?? isoDay(new Date());
  const last = dates.at(-1) ?? first;
  const start = utcDate(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const weeks: { start: string; days: string[] }[] = [];
  for (
    let cursor = start.getTime();
    weeks.length < 4 || cursor <= utcDate(last).getTime();
    cursor += 7 * DAY_MS
  ) {
    const days = Array.from({ length: 7 }, (_, index) =>
      isoDay(new Date(cursor + index * DAY_MS)),
    );
    weeks.push({ start: days[0] ?? "", days });
    if (weeks.length >= 6) break;
  }
  return weeks;
}

function formatDay(iso: string, options: Intl.DateTimeFormatOptions): string {
  return utcDate(iso).toLocaleDateString("en-GB", {
    ...options,
    timeZone: "UTC",
  });
}

function readiness(channel: string): "runs" | "soon" {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(channel)
    ? "runs"
    : "soon";
}

const CHANGE_IDEAS = [
  "Fewer posts, more depth",
  "More LinkedIn, less X",
  "Lead with our newest product",
  "A more playful voice",
];

interface StrategyStepProps {
  overview: CmoOverview;
  onChange: (note: string) => Promise<string | null>;
  onApprove: () => Promise<void>;
}

/**
 * The strategy, so a founder can decide to hire Cuso from it: the why, every
 * day of the next four weeks, and what their accounts will look like.
 */
export function StrategyStep({
  overview,
  onChange,
  onApprove,
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
  const [changing, startChanging] = useTransition();
  const [approving, startApproving] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const dates = strategy.calendar.map((entry) => entry.date).sort();
  const first = dates[0];
  const end = dates.at(-1);
  const pieces = strategy.calendar.length;
  const drafted = strategy.calendar.filter((entry) => entry.draft).length;
  const changes = strategy.changes ?? [];

  function requestChange(text: string) {
    const request = text.trim();
    if (!request) return;
    startChanging(async () => {
      setRefusal(await onChange(request));
      setNote("");
    });
  }

  return (
    <section className="ob-strategy">
      <header className="ob-plan-head">
        <p className="ob-eyebrow">
          Your strategy
          {first && end
            ? ` · ${formatDay(first, { day: "numeric", month: "short" })} to ${formatDay(end, { day: "numeric", month: "short" })}`
            : ""}
        </p>
        <h1 className="ob-plan-summary">{strategy.summary}</h1>
        <p className="ob-plan-stats">
          <span>{pieces} pieces</span>
          <span>{strategy.channels.length} channels</span>
          <span>{drafted} written out in full</span>
        </p>
      </header>

      {changes.length > 0 ? (
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

      {strategy.why ? (
        <div className="ob-why">
          <Lightbulb size={18} aria-hidden="true" />
          <div>
            <p className="ob-label">Why this plan</p>
            <Clamp items={[{ text: strategy.why }]} lines={3} />
          </div>
        </div>
      ) : null}

      <div className="ob-facts">
        <div className="ob-fact">
          <p className="ob-label">
            <Target size={14} aria-hidden="true" /> Goals
          </p>
          <ul className="ob-list">
            {strategy.goals.map((goal) => (
              <li key={goal}>{goal}</li>
            ))}
          </ul>
        </div>
        {strategy.audience ? (
          <div className="ob-fact">
            <p className="ob-label">
              <Users size={14} aria-hidden="true" /> Audience
            </p>
            <Clamp items={[{ text: strategy.audience }]} lines={3} />
          </div>
        ) : null}
        {strategy.positioning ? (
          <div className="ob-fact">
            <p className="ob-label">
              <Sparkles size={14} aria-hidden="true" /> Positioning
            </p>
            <Clamp items={[{ text: strategy.positioning }]} lines={3} />
          </div>
        ) : null}
      </div>

      {strategy.pillars.length > 0 ? (
        <div className="ob-pillars">
          <p className="ob-label">Content pillars</p>
          <div className="ob-chips">
            {strategy.pillars.map((pillar) => (
              <span key={pillar} className="ob-chip">
                {pillar}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <h2 className="ob-section">Channels</h2>
      <div className="ob-channel-grid">
        {strategy.channels.map((channel) => (
          <article key={channel.channel} className="ob-channel-card">
            <div className="ob-channel-top">
              <ChannelIcon channel={channel.channel} size={20} />
              <span className="ob-channel-name">
                {channelLabel(channel.channel)}
              </span>
              <span className={`ob-tag ${readiness(channel.channel)}`}>
                {readiness(channel.channel) === "runs"
                  ? "Cuso posts"
                  : "Coming soon"}
              </span>
            </div>
            <Clamp
              lines={1}
              items={[
                { text: channel.cadence, className: "ob-cadence" },
                ...(channel.why
                  ? [{ text: channel.why, className: "ob-note" }]
                  : []),
              ]}
            />
          </article>
        ))}
      </div>

      <h2 className="ob-section">Day by day</h2>
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
                return (
                  <div
                    key={day}
                    className={
                      entries.length ? "ob-day" : "ob-day ob-day-blank"
                    }
                  >
                    <span className="ob-day-n">
                      {formatDay(day, { day: "numeric" })}
                      {formatDay(day, { day: "numeric" }) === "1"
                        ? ` ${formatDay(day, { month: "short" })}`
                        : ""}
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
                          {entry.hook ?? entry.title}
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

      <h2 className="ob-section">What your accounts will look like</h2>
      <Showcases overview={overview} />

      <form
        className="ob-change"
        onSubmit={(event) => {
          event.preventDefault();
          requestChange(note);
        }}
      >
        <p className="ob-label">
          <Wand2 size={14} aria-hidden="true" /> Ask Cuso to change something
        </p>
        <div className="ob-change-row">
          <input
            className="ob-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. “Post less on X and add a weekly customer story”"
            aria-label="What should Cuso change?"
            disabled={changing}
          />
          <button
            type="submit"
            className="ob-button ob-button-quiet"
            disabled={changing || !note.trim()}
          >
            {changing ? (
              <Loader2 size={14} className="ob-spin" aria-hidden="true" />
            ) : null}
            Change it
          </button>
        </div>
        <div className="ob-chips">
          {CHANGE_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              className="ob-chip ob-chip-button"
              disabled={changing}
              onClick={() => requestChange(idea)}
            >
              {idea}
            </button>
          ))}
        </div>
        {refusal ? (
          <p className="ob-note" role="alert">
            {/credits/i.test(refusal)
              ? "You're out of credits. Top up on Sokosumi, then try again."
              : refusal}
          </p>
        ) : null}
      </form>

      <div className="ob-approve-bar">
        <p>
          <strong>This is the only thing you approve.</strong> From here Cuso
          writes, schedules and improves it on his own, and tells you what he
          did.
        </p>
        <button
          type="button"
          className="ob-button ob-button-lg"
          disabled={approving || changing}
          onClick={() => startApproving(onApprove)}
        >
          {approving ? "Approving…" : "Approve strategy"}
          <ArrowRight size={16} aria-hidden="true" />
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <EntryDrawer entry={open} onClose={() => setOpen(null)} />
        ) : null}
      </AnimatePresence>
    </section>
  );
}

function EntryDrawer({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
}) {
  return (
    <>
      <motion.button
        type="button"
        className="ob-scrim"
        aria-label="Close"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="ob-drawer"
        role="dialog"
        aria-label={entry.title}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] as const }}
      >
        <div className="ob-drawer-head">
          <ChannelIcon channel={entry.channel} size={18} />
          <span>
            {channelLabel(entry.channel)} · {entry.format}
          </span>
          <button
            type="button"
            className="ob-icon-button"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="ob-note ob-when">
          <Clock size={13} aria-hidden="true" />
          {formatDay(entry.date, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {entry.time ? ` at ${entry.time}` : ""}
        </p>
        <h3 className="ob-drawer-title">{entry.title}</h3>
        {entry.draft ? (
          <div className="ob-draft">{entry.draft}</div>
        ) : (
          <>
            {entry.hook ? <p className="ob-hook">“{entry.hook}”</p> : null}
            {entry.brief ? <p>{entry.brief}</p> : null}
            <p className="ob-note">
              Cuso writes the full piece a few days before it goes out.
            </p>
          </>
        )}
        {entry.why ? (
          <div className="ob-why ob-why-small">
            <Lightbulb size={15} aria-hidden="true" />
            <p>{entry.why}</p>
          </div>
        ) : null}
      </motion.aside>
    </>
  );
}
