"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Clock, PenLine, Play } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { type ReactNode, useMemo, useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  channelLabel,
  connectedNetworks,
  formatDay,
  pieceMade,
  planWeeks,
  waitsForNetwork,
  wholeWords,
} from "../../lib/calendar";
import { formatHasImage, formatHasVideo, formatName } from "../../lib/channels";
import { ChannelIcon } from "../channel-icon";
import { EntrySheet } from "../entry-sheet";
import { StatusDisc } from "../status";
import { type DraftActions, DraftPost } from "./draft-post";

type Strategy = NonNullable<CmoOverview["strategy"]>;
type Entry = Strategy["calendar"][number];
type Media = CmoOverview["media"][number];

const STATUS: Record<Entry["status"], string> = {
  idea: "Planned",
  draft: "Written",
  scheduled: "Scheduled",
  published: "Published",
  skipped: "Skipped",
};

/**
 * Where a post stands, in words beside a small mark: never a pill. A written
 * post on a network that is not connected says what it waits for.
 */
export function PieceState({
  status,
  waitsFor = null,
}: {
  status: Entry["status"];
  waitsFor?: string | null;
}) {
  if (waitsFor) {
    return (
      <span className="state">
        <StatusDisc status="warn" decorative />
        Waiting for {channelLabel(waitsFor)}
      </span>
    );
  }
  return (
    <span className="state">
      {status === "published" ? (
        <StatusDisc status="ok" decorative />
      ) : status === "scheduled" ? (
        <Clock size={13} aria-hidden="true" />
      ) : status === "draft" ? (
        <PenLine size={13} aria-hidden="true" />
      ) : null}
      {STATUS[status]}
    </span>
  );
}

function samePillar(named: string | undefined, pillar: string): boolean {
  return named?.trim().toLowerCase() === pillar.trim().toLowerCase();
}

/** The first words of a piece, without Markdown, for its card. */
function excerpt(entry: Entry): string {
  const text = entry.draft ?? entry.brief ?? "";
  return wholeWords(
    text
      .replace(/[#*_>`[\]()]/g, "")
      .replace(/\s+/g, " ")
      .trim(),
    320,
  );
}

/**
 * The month piece by piece: every post, article, ad and email Cuso makes,
 * as cards by week. A made piece opens in full and the sheet steps to the
 * next made one; a piece still being made shows only that it is coming.
 */
export function CalendarPage({
  overview,
  drafts,
  onAsk,
  loadText,
  pieceExtra,
  onConnect,
}: {
  overview: CmoOverview;
  /** Approve, decline or rewrite a post that waits for the owner. */
  drafts: DraftActions;
  /** Opens Channels, where a network a post waits for is connected. */
  onConnect?: () => void;
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

  // Posts Cuso made on request, outside the month: they go out only once
  // the owner says so, so they lead the page.
  const waiting =
    overview.drafts.length > 0 ? (
      <section className="cal-week" aria-labelledby="cal-waiting">
        <h3 className="cal-week-head" id="cal-waiting">
          Waiting for you
          <span className="note num">
            {overview.drafts.length === 1
              ? "1 post"
              : `${overview.drafts.length} posts`}
          </span>
        </h3>
        <div className="cal-waiting">
          {overview.drafts.map((draft) => (
            <DraftPost key={draft.id} draft={draft} actions={drafts} />
          ))}
        </div>
      </section>
    ) : null;

  if (!strategy) {
    return (
      <div className="cal">
        {waiting}
        <div className="empty">
          <span className="shape" aria-hidden="true" />
          <span>{AGENT_NAME} is still writing the strategy.</span>
        </div>
      </div>
    );
  }

  const mediaFor = (entry: Entry) =>
    overview.media.find((item) => item.entryId === entry.id);
  const made = (entry: Entry) => pieceMade(entry, Boolean(mediaFor(entry)));
  const connected = connectedNetworks(overview.channels);
  const waitingFor = [
    ...new Set(
      live.flatMap((entry) => waitsForNetwork(entry, connected) ?? []),
    ),
  ];
  const ready = live.filter(made).length;
  const readable = shown.filter(made);
  const index = readable.findIndex((entry) => entry.id === openId);
  const open = index >= 0 ? readable[index] : undefined;

  return (
    <div className="cal">
      {waiting}
      <div className="card cal-head">
        <p className="note num">
          {live.length} posts this month · {ready} ready
          {ready < live.length ? ` · ${live.length - ready} being made` : ""}
        </p>
        {waitingFor.map((network) => {
          const count = live.filter(
            (entry) => waitsForNetwork(entry, connected) === network,
          ).length;
          return (
            <p key={network} className="cal-waits">
              <StatusDisc status="warn" decorative />
              <span className="grow">
                {count === 1 ? "1 post is" : `${count} posts are`} written and
                {count === 1 ? " waits" : " wait"} for {channelLabel(network)}.
                Connect it and {count === 1 ? "it goes" : "they go"} out on
                schedule.
              </span>
              {onConnect ? (
                <button
                  type="button"
                  className="button button-secondary button-small"
                  onClick={onConnect}
                >
                  Connect {channelLabel(network)}
                </button>
              ) : null}
            </p>
          );
        })}
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
                  {made(entry) ? (
                    <PieceCard
                      entry={entry}
                      media={mediaFor(entry)}
                      open={entry.id === openId}
                      onOpen={() => setOpenId(entry.id)}
                      waitsFor={waitsForNetwork(entry, connected)}
                    />
                  ) : (
                    <PieceInMaking entry={entry} />
                  )}
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
            overview={overview}
            state={
              <PieceState
                status={open.status}
                waitsFor={waitsForNetwork(open, connected)}
              />
            }
            onEdit={
              editable(open, overview.postRevisions)
                ? (text) =>
                    drafts.edit(
                      open.socialPostId ?? open.id,
                      overview.postRevisions[open.socialPostId ?? open.id] ?? 0,
                      text,
                    )
                : undefined
            }
            onClose={() => setOpenId(null)}
            onAsk={onAsk}
            loadText={loadText}
            extra={pieceExtra?.(open)}
            position={{ index, total: readable.length }}
            onPrev={
              index > 0
                ? () => setOpenId(readable[index - 1]?.id ?? null)
                : undefined
            }
            onNext={
              index < readable.length - 1
                ? () => setOpenId(readable[index + 1]?.id ?? null)
                : undefined
            }
          />
        ) : null}
      </AnimatePresence>
    </div>
  );
}

/** The owner may rewrite the words of a Social post that has not gone out. */
function editable(
  entry: Entry,
  revisions: CmoOverview["postRevisions"],
): boolean {
  return (
    Boolean(entry.socialPostId) &&
    (entry.status === "draft" || entry.status === "scheduled") &&
    revisions[entry.socialPostId ?? ""] !== undefined
  );
}

/** A piece Cuso is still making: where and when, never its unfinished words. */
function PieceInMaking({ entry }: { entry: Entry }) {
  return (
    <div className="cal-card cal-making">
      <span className="cal-thumb" aria-hidden="true">
        <span className="cal-making-lines">
          <span />
          <span />
        </span>
      </span>
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
        <span className="state">
          <span className="ob-box-dot" aria-hidden="true" />
          Being made
        </span>
      </span>
    </div>
  );
}

function PieceCard({
  entry,
  media,
  open,
  onOpen,
  waitsFor,
}: {
  entry: Entry;
  media?: Media;
  open: boolean;
  onOpen: () => void;
  waitsFor: string | null;
}) {
  const picture =
    media?.slides?.[0] ?? (media?.kind === "image" ? media.url : null);
  // Every card leads with the same box, so a row stays even: the picture or
  // video, or the opening words of a post that has neither.
  const visual =
    Boolean(media) ||
    formatHasImage(entry.channel, entry.format) ||
    formatHasVideo(entry.channel, entry.format);
  const words = excerpt(entry);
  return (
    <button
      type="button"
      className={open ? "cal-card card-focus" : "cal-card"}
      onClick={onOpen}
    >
      {!visual && words ? (
        <span className="cal-thumb cal-words">
          <span>{words}</span>
        </span>
      ) : (
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
      )}
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
        {visual && words ? <span className="cal-excerpt">{words}</span> : null}
        <PieceState status={entry.status} waitsFor={waitsFor} />
      </span>
    </button>
  );
}
