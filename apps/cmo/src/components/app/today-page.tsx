"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, MessageSquare } from "lucide-react";
import { AGENT_NAME } from "../../lib/agent";
import { channelLabel, formatDay } from "../../lib/calendar";
import { channelTone, formatName } from "../../lib/channels";
import { cusoPose } from "../../lib/thread";
import {
  dayIn,
  greeting,
  monthEntries,
  monthProgress,
  type NeedsYou,
  needsYou,
  weekOf,
} from "../../lib/today";
import type { View } from "../../lib/views";
import { ChannelIcon } from "../channel-icon";
import { type CusoArt, cusoArt } from "../cuso";
import { StatusDisc } from "../status";

type Entry = ReturnType<typeof monthEntries>[number];

const POSE_ART: Record<ReturnType<typeof cusoPose>, CusoArt> = {
  reading: "searching",
  thinking: "thinking",
  "needs-you": "pointing",
  reporting: "walking",
  done: "thumbs-up",
};

interface TodayPageProps {
  overview: CmoOverview;
  firstName: string;
  open: (view: View) => void;
  /** Opens one post of the month on the Calendar. */
  openEntry: (entryId: string) => void;
  /** Opens the chat with the cursor in the box. */
  ask: () => void;
  /** Pins the clock (previews, tests). */
  now?: Date;
}

/**
 * Home: what needs the owner, what goes out this week and how far the month
 * is, at a glance. Cuso is one tap away.
 */
export function TodayPage({
  overview,
  firstName,
  open,
  openEntry,
  ask,
  now = new Date(),
}: TodayPageProps) {
  const needs = needsYou(overview);
  const entries = monthEntries(overview);
  const today = dayIn(overview.timeZone, now);
  const pose = needs.length > 0 ? "needs-you" : cusoPose(overview, now);
  return (
    <div className="today">
      <header className="today-hero">
        <img
          className="today-cuso"
          src={cusoArt(POSE_ART[pose])}
          alt=""
          width={112}
          height={112}
        />
        <div className="today-hello">
          <h1 className="ob-h1">
            {greeting(overview.timeZone, now)}
            {firstName ? `, ${firstName}` : ""}
          </h1>
          <p className="today-says">{saying(overview, needs.length)}</p>
        </div>
      </header>

      <NeedsYouList items={needs} open={open} />

      <section className="today-section" aria-labelledby="today-week">
        <div className="today-section-head">
          <h2 id="today-week">This week</h2>
          <button
            type="button"
            className="button button-ghost button-small"
            onClick={() => open("calendar")}
          >
            Whole month
          </button>
        </div>
        <WeekStrip entries={entries} today={today} openEntry={openEntry} />
      </section>

      {entries.length > 0 ? (
        <section className="today-section" aria-labelledby="today-month">
          <div className="today-section-head">
            <h2 id="today-month">This month</h2>
            <button
              type="button"
              className="button button-ghost button-small"
              onClick={() => open("results")}
            >
              Results
            </button>
          </div>
          <MonthBar entries={entries} />
        </section>
      ) : null}

      <button type="button" className="today-ask" onClick={ask}>
        <MessageSquare size={18} aria-hidden="true" />
        <span className="grow">Ask {AGENT_NAME} anything</span>
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </div>
  );
}

/** What Cuso says on top of the day, in one line. */
function saying(overview: CmoOverview, needs: number): string {
  if (needs === 1) return "One thing needs you. The rest is on me.";
  if (needs > 1) return `${needs} things need you. The rest is on me.`;
  if (overview.botStatus === "RUNNING") {
    return `I'm on it: ${overview.activity?.step ?? "working"}.`;
  }
  if (overview.production.state === "running") {
    return `I'm making your month: ${overview.production.ready} of ${overview.production.total} ready.`;
  }
  return "Nothing needs you. Everything goes out on its day.";
}

function NeedsYouList({
  items,
  open,
}: {
  items: NeedsYou[];
  open: (view: View) => void;
}) {
  if (items.length === 0) {
    return (
      <section className="today-clear" aria-label="Needs you">
        <StatusDisc status="ok" decorative />
        <span>
          <b>All clear.</b> Nothing waits for you.
        </span>
      </section>
    );
  }
  return (
    <section className="today-section" aria-labelledby="today-needs">
      <div className="today-section-head">
        <h2 id="today-needs">Needs you</h2>
        <span className="count num">{items.length}</span>
      </div>
      <ul className="needs">
        {items.map((item, index) => (
          <li key={item.id} className="needs-row">
            <span className="needs-mark" aria-hidden="true">
              !
            </span>
            <span className="needs-text">
              <b>{item.title}</b>
              <span className="note">{item.detail}</span>
            </span>
            <button
              type="button"
              // One primary action on the page: the first thing to do.
              className={
                index === 0 ? "button" : "button button-secondary button-small"
              }
              onClick={() => open(item.view)}
            >
              {item.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Seven days, Monday first; today stands on Iris. Each post opens on tap. */
export function WeekStrip({
  entries,
  today,
  openEntry,
}: {
  entries: Entry[];
  today: string;
  openEntry: (entryId: string) => void;
}) {
  const days = weekOf(today);
  const thisWeek = entries.filter((entry) => days.includes(entry.date));
  return (
    <ol className="week" aria-label="This week">
      {days.map((day) => {
        const posts = thisWeek.filter((entry) => entry.date === day);
        const isToday = day === today;
        return (
          <li
            key={day}
            className={isToday ? "week-day week-today" : "week-day"}
            aria-current={isToday ? "date" : undefined}
            data-empty={posts.length === 0 ? "" : undefined}
          >
            <span className="week-date">
              <span>{formatDay(day, { weekday: "short" })}</span>
              <b className="num">{formatDay(day, { day: "numeric" })}</b>
              {isToday ? <span className="week-label">Today</span> : null}
            </span>
            {posts.length === 0 ? (
              <span className="week-none note">Nothing</span>
            ) : (
              <span className="week-posts">
                {posts.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={`week-post net-${channelTone(entry.channel)}`}
                    onClick={() => openEntry(entry.id)}
                    aria-label={`${channelLabel(entry.channel)} ${formatName(entry.channel, entry.format)}${entry.time ? ` at ${entry.time}` : ""}: ${entry.title}`}
                  >
                    <span className="week-post-meta">
                      <ChannelIcon channel={entry.channel} size={12} />
                      {entry.time ? (
                        <span className="num">{entry.time}</span>
                      ) : null}
                      {entry.status === "published" ? (
                        <span className="week-out">Out</span>
                      ) : null}
                    </span>
                    <span className="week-post-title">{entry.title}</span>
                  </button>
                ))}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** The month as one bar: out, scheduled, written, still to make. */
export function MonthBar({ entries }: { entries: Entry[] }) {
  const progress = monthProgress(entries);
  const parts = [
    ["out", "Out", progress.out],
    ["scheduled", "Scheduled", progress.scheduled],
    ["written", "Written", progress.written],
    ["planned", "To make", progress.planned],
  ] as const;
  return (
    <div className="month">
      <p className="month-lead">
        <span className="value num">{progress.out}</span>
        <span className="muted">
          of {progress.total} {progress.total === 1 ? "post" : "posts"} out
        </span>
      </p>
      <span
        className="month-bar"
        role="img"
        aria-label={parts.map(([, label, n]) => `${label} ${n}`).join(", ")}
      >
        {parts.map(([key, , count]) =>
          count > 0 ? (
            <span
              key={key}
              className={`month-part month-${key}`}
              style={{ flexGrow: count }}
            />
          ) : null,
        )}
      </span>
      <ul className="month-legend">
        {parts.map(([key, label, count]) => (
          <li key={key}>
            <span className={`month-swatch month-${key}`} aria-hidden="true" />
            {label} <b className="num">{count}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Each network's posts this month: out on its colour, still to come outlined. */
export function NetworkBars({ entries }: { entries: Entry[] }) {
  const networks = [...new Set(entries.map((entry) => entry.channel))]
    .map((channel) => {
      const mine = entries.filter((entry) => entry.channel === channel);
      return {
        channel,
        total: mine.length,
        out: mine.filter((entry) => entry.status === "published").length,
      };
    })
    .sort((a, b) => b.total - a.total);
  const most = Math.max(1, ...networks.map((network) => network.total));
  return (
    <ul className="netbars">
      {networks.map(({ channel, total, out }) => (
        <li key={channel}>
          <span className="netbars-name">
            <ChannelIcon channel={channel} size={14} />
            {channelLabel(channel)}
          </span>
          <span
            className="netbars-track"
            role="img"
            aria-label={`${channelLabel(channel)}: ${out} of ${total} out`}
            style={{ width: `${(total / most) * 100}%` }}
          >
            {out > 0 ? (
              <span
                className={`netbars-out net-${channelTone(channel)}`}
                style={{ width: `${(out / total) * 100}%` }}
              />
            ) : null}
          </span>
          <span className="netbars-count num">
            {out} of {total}
          </span>
        </li>
      ))}
    </ul>
  );
}
