"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { useState } from "react";
import { channelLabel, formatDay } from "../../lib/calendar";
import { channelTone, formatName } from "../../lib/channels";
import {
  dayIn,
  greeting,
  monthEntries,
  monthProgress,
  type NeedsYou,
  needsYou,
  todayLine,
  weekOf,
} from "../../lib/today";
import type { View } from "../../lib/views";
import { ChannelIcon } from "../channel-icon";

type Entry = ReturnType<typeof monthEntries>[number];

interface TodayPageProps {
  overview: CmoOverview;
  firstName: string;
  open: (view: View) => void;
  /** Opens one post of the month on the Calendar. */
  openEntry: (entryId: string) => void;
  /** Pins the clock (previews, tests). */
  now?: Date;
}

/**
 * Home: how far the month is, what goes out this week and, last, what needs
 * the owner, at a glance.
 */
export function TodayPage({
  overview,
  firstName,
  open,
  openEntry,
  now = new Date(),
}: TodayPageProps) {
  const needs = needsYou(overview);
  const entries = monthEntries(overview);
  const today = dayIn(overview.timeZone, now);
  return (
    <div className="today">
      <header className="today-hello">
        <h1 className="page-title">
          {greeting(overview.timeZone, now)}
          {firstName ? `, ${firstName}` : ""}.
        </h1>
        <p className="today-says">{todayLine(overview, needs.length)}</p>
      </header>

      {entries.length > 0 ? (
        <section className="card today-month" aria-labelledby="today-month">
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

      <section
        // An empty week keeps its own height instead of filling the screen.
        className={
          entries.some((entry) => weekOf(today).includes(entry.date))
            ? "today-section today-week"
            : "today-section today-week-empty"
        }
        aria-labelledby="today-week"
      >
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

      {/* Last, under Cuso's pointing hand at the sidebar's foot. */}
      <NeedsYouList items={needs} open={open} openEntry={openEntry} />
    </div>
  );
}

function NeedsYouList({
  items,
  open,
  openEntry,
}: {
  items: NeedsYou[];
  open: (view: View) => void;
  openEntry: (entryId: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section
      className="today-section today-needs"
      aria-labelledby="today-needs"
    >
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
              onClick={() =>
                item.entryId ? openEntry(item.entryId) : open(item.view)
              }
            >
              {item.action}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Posts a day shows before "+N more"; two on a short window. */
const DAY_SHOWS = 3;
const SHORT_SHOWS = 2;

/**
 * Seven days, Monday first; today stands on Iris. A day counts its posts per
 * network and shows the first three; "+N more" or its date opens the rest.
 * On a phone the week is a row of dates over the open day (today at first).
 */
export function WeekStrip({
  entries,
  today,
  openEntry,
}: {
  entries: Entry[];
  today: string;
  openEntry: (entryId: string) => void;
}) {
  const [openDay, setOpenDay] = useState<string | null>(null);
  const days = weekOf(today);
  const shownDay = openDay ?? today;
  return (
    <ol className="week" aria-label="This week">
      {days.map((day) => {
        const posts = entries.filter((entry) => entry.date === day);
        const isOpen = day === openDay;
        const isToday = day === today;
        const shown = isOpen ? posts : posts.slice(0, DAY_SHOWS);
        const more = posts.length - shown.length;
        const name = formatDay(day, { weekday: "long", day: "numeric" });
        return (
          <li
            key={day}
            className={isToday ? "week-day week-today" : "week-day"}
            aria-current={isToday ? "date" : undefined}
            data-shown={day === shownDay ? "" : undefined}
            data-empty={posts.length === 0 ? "" : undefined}
          >
            <button
              type="button"
              className="week-date"
              aria-expanded={isOpen}
              aria-label={`${name}${isToday ? ", today" : ""}: ${posts.length === 1 ? "1 post" : `${posts.length} posts`}`}
              onClick={() => setOpenDay(isOpen ? null : day)}
            >
              <span>{formatDay(day, { weekday: "short" })}</span>
              <b className="num">{formatDay(day, { day: "numeric" })}</b>
              {isToday ? <span className="week-label">Today</span> : null}
              <span className="week-total num" aria-hidden="true">
                {posts.length || ""}
              </span>
            </button>
            {posts.length === 0 ? (
              <span className="week-none note">Nothing</span>
            ) : (
              <>
                <NetworkCounts posts={posts} />
                <span className="week-posts">
                  {shown.map((entry, index) => (
                    <button
                      key={entry.id}
                      type="button"
                      // A short window shows two a day; the third gives way.
                      className={`week-post net-${channelTone(entry.channel)}${!isOpen && index === SHORT_SHOWS ? " week-post-extra" : ""}`}
                      onClick={() => openEntry(entry.id)}
                      aria-label={`${channelLabel(entry.channel)} ${formatName(entry.channel, entry.format)}${entry.time ? ` at ${entry.time}` : ""}${entry.status === "published" ? ", out" : ""}: ${entry.title}`}
                    >
                      <ChannelIcon channel={entry.channel} size={12} />
                      {entry.time ? (
                        <span className="num">{entry.time}</span>
                      ) : null}
                      <span className="week-post-title">{entry.title}</span>
                    </button>
                  ))}
                </span>
                {!isOpen && posts.length > SHORT_SHOWS ? (
                  <button
                    type="button"
                    className={
                      more > 0 ? "week-more" : "week-more week-more-short"
                    }
                    onClick={() => setOpenDay(day)}
                  >
                    {more > 0 ? (
                      <span className="more-wide">+{more} more</span>
                    ) : null}
                    <span className="more-short">
                      +{posts.length - SHORT_SHOWS} more
                    </span>
                  </button>
                ) : null}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** How many posts a day holds on each network, as small chips on its fill. */
function NetworkCounts({ posts }: { posts: Entry[] }) {
  const counts = new Map<string, number>();
  for (const post of posts) {
    counts.set(post.channel, (counts.get(post.channel) ?? 0) + 1);
  }
  return (
    <ul className="week-nets">
      {[...counts].map(([channel, count]) => (
        <li
          key={channel}
          className={`week-net net-${channelTone(channel)}`}
          aria-label={`${channelLabel(channel)}: ${count}`}
        >
          <ChannelIcon channel={channel} size={11} />
          <span className="num" aria-hidden="true">
            {count}
          </span>
        </li>
      ))}
    </ul>
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
    // Only when one did: the bar's usual four stay put.
    ...(progress.notSent > 0
      ? ([["not-sent", "Didn't go out", progress.notSent]] as const)
      : []),
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
