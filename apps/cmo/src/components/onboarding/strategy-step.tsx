"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  ArrowRight,
  Check,
  Lightbulb,
  Loader2,
  Sparkles,
  Target,
  Users,
  Wand2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, useTransition } from "react";

import {
  channelLabel,
  formatDay,
  planRange,
  planWeeks,
  SOCIAL_PROVIDERS,
} from "../../lib/calendar";
import { changeIdeas } from "../../lib/change-ideas";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { Clamp } from "./clamp";
import { Refusal } from "./refusal";
import { Showcases, withoutLabel } from "./showcases";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function runs(channel: string): boolean {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(channel);
}

interface StrategyStepProps {
  overview: CmoOverview;
  onChange: (note: string) => Promise<string | null>;
  onApprove: () => Promise<void>;
}

/**
 * The strategy, so a founder can decide to hire Cuso from it: the why, every
 * day of the next four weeks, and what their accounts will look like. While
 * Cuso writes or changes it, the plan stays on screen and fills in.
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
  const [asked, setAsked] = useState<string | null>(null);
  const [changing, startChanging] = useTransition();
  const [approving, startApproving] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const work = overview.work;
  const writing = work?.kind === "strategy" && work.status === "running";
  const pieces = strategy.calendar.length;
  const drafted = strategy.calendar.filter((entry) => entry.draft).length;
  const stopped =
    work?.kind === "strategy" &&
    work.status === "failed" &&
    (asked !== null || drafted < pieces);
  const busy = writing || changing;
  const range = planRange(strategy.calendar);
  const changes = strategy.changes ?? [];
  const running = strategy.channels.filter((channel) => runs(channel.channel));
  const drafts = strategy.channels.filter((channel) => !runs(channel.channel));

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
      <header className="ob-plan-head">
        <p className="ob-eyebrow">Your strategy{range ? ` · ${range}` : ""}</p>
        <h1 className="ob-plan-summary">{strategy.summary}</h1>
        <p className="ob-plan-stats">
          <span>{pieces} pieces</span>
          <span>{strategy.channels.length} channels</span>
          <span>
            {drafted === pieces
              ? "All written out in full"
              : `${drafted} of ${pieces} written out in full`}
          </span>
        </p>
      </header>

      {writing ? (
        <div className="ob-writing" role="status">
          <Loader2 size={16} className="ob-spin" aria-hidden="true" />
          <div>
            <p className="ob-writing-title">
              {asked
                ? "Cuso is changing your plan"
                : drafted < pieces
                  ? `Cuso is writing every piece in full: ${drafted} of ${pieces} done`
                  : "Cuso is finishing your plan"}
            </p>
            <p className="ob-note">
              {asked
                ? `You asked: “${asked}”. The plan below updates when he's done, in about two minutes.`
                : "Look around; the plan fills in as he writes."}
            </p>
          </div>
        </div>
      ) : stopped ? (
        <p className="ob-alert" role="alert">
          {asked
            ? "That change didn't go through. Ask again below."
            : "Cuso stopped before every piece was written. Ask him below to finish the plan."}
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
        {running.map((channel) => (
          <article key={channel.channel} className="ob-channel-card">
            <div className="ob-channel-top">
              <ChannelIcon channel={channel.channel} size={20} />
              <span className="ob-channel-name">
                {channelLabel(channel.channel)}
              </span>
              <span className="ob-tag runs">Cuso posts</span>
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
      {drafts.length > 0 ? (
        <p className="ob-note ob-drafted-channels">
          <span className="ob-drafted-icons" aria-hidden="true">
            {drafts.map((channel) => (
              <ChannelIcon
                key={channel.channel}
                channel={channel.channel}
                size={14}
              />
            ))}
          </span>
          Cuso also writes your{" "}
          {drafts.map((channel) => channelLabel(channel.channel)).join(", ")}{" "}
          pieces. You publish those yourself for now.
        </p>
      ) : null}

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

      <div className="ob-approve-bar">
        <p>
          <strong>This is the only thing you approve.</strong> From here Cuso
          writes, schedules and improves it on his own, and tells you what he
          did.
        </p>
        <button
          type="button"
          className="ob-button ob-button-lg"
          disabled={approving || busy}
          onClick={() => startApproving(onApprove)}
        >
          {approving
            ? "Approving…"
            : writing
              ? asked
                ? "Cuso is changing it"
                : "Cuso is still writing"
              : "Approve strategy"}
          {writing ? null : <ArrowRight size={16} aria-hidden="true" />}
        </button>
      </div>

      <AnimatePresence>
        {open ? (
          <EntrySheet entry={open} onClose={() => setOpen(null)} />
        ) : null}
      </AnimatePresence>
    </section>
  );
}
