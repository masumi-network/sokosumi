"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check, Clock, Play } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";

import { channelLabel, formatDay, planWeeks } from "../../lib/calendar";
import { formatHasImage, formatHasVideo, formatName } from "../../lib/channels";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Media = CmoOverview["media"][number];

const STATUS: Record<Entry["status"], { label: string; strong: boolean }> = {
  idea: { label: "Planned", strong: false },
  draft: { label: "Written", strong: true },
  scheduled: { label: "Scheduled", strong: true },
  published: { label: "Published", strong: true },
  skipped: { label: "Skipped", strong: false },
};

function samePillar(named: string | undefined, pillar: string): boolean {
  return named?.trim().toLowerCase() === pillar.trim().toLowerCase();
}

/** The first words of a piece, without Markdown, for its card. */
function excerpt(entry: Entry): string {
  const text = entry.draft ?? entry.brief ?? "";
  return text
    .replace(/[#*_>`[\]()]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/**
 * The month piece by piece: every post, article, ad and email Cuso makes,
 * as cards by week. A card opens the piece in full; the sheet steps to the
 * next one, so the founder can read the whole month in a row.
 */
export function CalendarPage({
  overview,
  onAsk,
  loadText,
  pieceExtra,
}: {
  overview: CmoOverview;
  onAsk: (text: string) => Promise<void>;
  /** The words of a piece kept in the owner's Files. */
  loadText?: (entryId: string) => Promise<string | null>;
  /** What the owner can do with a piece beyond reading it (launch an ad). */
  pieceExtra?: (entry: Entry) => ReactNode;
}) {
  // The month being made; a change waiting for approval does not empty it.
  const strategy = overview.approvedStrategy ?? overview.strategy;
  const [channel, setChannel] = useState<string | null>(null);
  const [pillar, setPillar] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const live = useMemo(
    () =>
      (strategy?.calendar ?? [])
        .filter((entry) => entry.status !== "skipped")
        .sort(
          (a, b) =>
            a.date.localeCompare(b.date) ||
            (a.time ?? "").localeCompare(b.time ?? ""),
        ),
    [strategy],
  );
  const channels = useMemo(
    () => [...new Set(live.map((entry) => entry.channel))],
    [live],
  );
  const shown = live.filter(
    (entry) =>
      (!channel || entry.channel === channel) &&
      (!pillar || samePillar(entry.pillar, pillar)),
  );
  const pillars = strategy?.pillars ?? [];
  const weeks = useMemo(() => planWeeks(live), [live]);

  if (!strategy) {
    return (
      <div className="empty">
        <span className="shape" aria-hidden="true" />
        <span>Cuso is still writing the strategy.</span>
      </div>
    );
  }

  const written = live.filter((entry) => entry.status !== "idea").length;
  const scheduled = live.filter(
    (entry) => entry.status === "scheduled" || entry.status === "published",
  ).length;
  const mediaFor = (entry: Entry) =>
    overview.media.find((item) => item.entryId === entry.id);
  const index = shown.findIndex((entry) => entry.id === openId);
  const open = index >= 0 ? shown[index] : undefined;

  return (
    <div className="cal">
      <div className="cal-head">
        <p className="note num">
          {live.length} pieces this month · {written} written · {scheduled}{" "}
          scheduled
        </p>
        <div className="cal-filters" role="group" aria-label="Network">
          <button
            type="button"
            className="cal-filter"
            aria-pressed={channel === null}
            onClick={() => setChannel(null)}
          >
            All
          </button>
          {channels.map((key) => (
            <button
              key={key}
              type="button"
              className="cal-filter"
              aria-pressed={channel === key}
              onClick={() => setChannel(key)}
            >
              <ChannelIcon channel={key} size={13} />
              {channelLabel(key)}
              <span className="num">
                {live.filter((entry) => entry.channel === key).length}
              </span>
            </button>
          ))}
        </div>
        {pillars.length > 0 ? (
          <div className="cal-filters" role="group" aria-label="Pillar">
            <button
              type="button"
              className="cal-filter"
              aria-pressed={pillar === null}
              onClick={() => setPillar(null)}
            >
              Every pillar
            </button>
            {pillars.map(({ name }) => (
              <button
                key={name}
                type="button"
                className="cal-filter"
                aria-pressed={pillar === name}
                onClick={() => setPillar(name)}
              >
                {name}
                <span className="num">
                  {
                    live.filter((entry) => samePillar(entry.pillar, name))
                      .length
                  }
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {weeks.map((week, weekIndex) => {
        const days = new Set(week.days);
        const pieces = shown.filter((entry) => days.has(entry.date));
        if (pieces.length === 0) return null;
        return (
          <section key={week.start} className="cal-week">
            <h3 className="cal-week-head">
              Week {weekIndex + 1}
              <span className="note num">
                {formatDay(week.days[0] ?? week.start, {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            </h3>
            <ul className="cal-grid">
              {pieces.map((entry) => (
                <li key={entry.id}>
                  <PieceCard
                    entry={entry}
                    media={mediaFor(entry)}
                    onOpen={() => setOpenId(entry.id)}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <AnimatePresence>
        {open ? (
          <EntrySheet
            key="sheet"
            entry={open}
            media={mediaFor(open)}
            onClose={() => setOpenId(null)}
            onAsk={onAsk}
            loadText={loadText}
            extra={pieceExtra?.(open)}
            position={{ index, total: shown.length }}
            onPrev={
              index > 0
                ? () => setOpenId(shown[index - 1]?.id ?? null)
                : undefined
            }
            onNext={
              index < shown.length - 1
                ? () => setOpenId(shown[index + 1]?.id ?? null)
                : undefined
            }
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function PieceCard({
  entry,
  media,
  onOpen,
}: {
  entry: Entry;
  media?: Media;
  onOpen: () => void;
}) {
  const status = STATUS[entry.status];
  const picture =
    media?.slides?.[0] ?? (media?.kind === "image" ? media.url : null);
  // Words-only pieces (an article, an email) get no empty picture box.
  const visual =
    Boolean(media) ||
    formatHasImage(entry.channel, entry.format) ||
    formatHasVideo(entry.channel, entry.format);
  return (
    <button type="button" className="cal-card" onClick={onOpen}>
      {visual ? (
        <span className="cal-thumb">
          {picture ? (
            <img src={picture} alt="" loading="lazy" />
          ) : media?.kind === "video" ? (
            <>
              <video
                src={`${media.url}#t=0.1`}
                muted
                playsInline
                preload="metadata"
              />
              <Play size={18} className="cal-play" aria-hidden="true" />
            </>
          ) : (
            <ChannelIcon channel={entry.channel} size={28} />
          )}
          {media?.slides ? (
            <span className="cal-slides num">{media.slides.length}</span>
          ) : null}
        </span>
      ) : null}
      <span className="cal-body">
        <span className="cal-meta">
          <ChannelIcon channel={entry.channel} size={13} />
          {formatName(entry.channel, entry.format)}
          <span className="cal-when num">
            <Clock size={12} aria-hidden="true" />
            {formatDay(entry.date, { weekday: "short", day: "numeric" })}
            {entry.time ? ` ${entry.time}` : ""}
          </span>
        </span>
        {entry.pillar ? (
          <span className="cal-pillar">{entry.pillar}</span>
        ) : null}
        <span className="cal-title">{entry.title}</span>
        {excerpt(entry) ? (
          <span className="cal-excerpt">{excerpt(entry)}</span>
        ) : null}
        <span className={status.strong ? "tag strong" : "tag"}>
          {entry.status === "published" ? (
            <Check size={11} aria-hidden="true" />
          ) : null}
          {status.label}
        </span>
      </span>
    </button>
  );
}
