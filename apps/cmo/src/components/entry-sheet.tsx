"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Clock, Lightbulb, Loader2, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, useTransition } from "react";

import { channelLabel, formatDay } from "../lib/calendar";
import { formatHasImage, formatHasVideo, formatName } from "../lib/channels";
import { ChannelIcon } from "./channel-icon";
import { DraftText } from "./draft-text";
import { withoutLabel } from "./showcases";

type Entry = NonNullable<CmoOverview["strategy"]>["calendar"][number];
type Media = CmoOverview["media"][number];

/**
 * One planned piece in a side sheet: when and where it goes out, the full
 * text, and why it is in the plan. Wrap it in AnimatePresence.
 */
export function EntrySheet({
  entry,
  media,
  onClose,
  onAsk,
}: {
  entry: Entry;
  /** The image or video Cuso made for this piece, once he has. */
  media?: Media;
  onClose: () => void;
  /** Sends Cuso a change to this one piece. */
  onAsk?: (text: string) => Promise<void>;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {/* The sheet's Close button is its one control; the scrim only catches clicks. */}
      <motion.div
        className="sheet-scrim"
        aria-hidden="true"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      />
      <motion.aside
        className="sheet"
        role="dialog"
        aria-label={entry.title}
        initial={{ x: 40, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.25, 1, 0.5, 1] as const }}
      >
        <div className="sheet-head">
          <ChannelIcon channel={entry.channel} size={18} />
          <span>
            {channelLabel(entry.channel)} ·{" "}
            {formatName(entry.channel, entry.format)}
            {formatHasVideo(entry.channel, entry.format)
              ? " · video by Cuso"
              : formatHasImage(entry.channel, entry.format)
                ? " · image by Cuso"
                : ""}
          </span>
          <button
            type="button"
            className="sheet-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <p className="note sheet-when">
          <Clock size={13} aria-hidden="true" />
          {formatDay(entry.date, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
          {entry.time ? ` at ${entry.time}` : ""}
        </p>
        <h3 className="sheet-title">{entry.title}</h3>
        {media?.kind === "video" ? (
          <video
            className="sheet-media"
            src={media.url}
            controls
            playsInline
            preload="metadata"
            aria-label={`Video for ${entry.title}`}
          />
        ) : media?.kind === "image" ? (
          <img className="sheet-media" src={media.url} alt={entry.title} />
        ) : null}
        {entry.draft ? (
          <div className="sheet-draft">
            <DraftText text={entry.draft} title={entry.title} />
          </div>
        ) : (
          <>
            {entry.hook ? (
              <p className="sheet-hook">“{withoutLabel(entry.hook)}”</p>
            ) : null}
            {entry.brief ? <p>{entry.brief}</p> : null}
            <p className="note">
              Cuso makes it with the rest of the month once you subscribe.
            </p>
          </>
        )}
        {entry.why ? (
          <div className="sheet-why">
            <Lightbulb size={15} aria-hidden="true" />
            <p>{entry.why}</p>
          </div>
        ) : null}
        {onAsk ? <ChangePiece entry={entry} onAsk={onAsk} /> : null}
      </motion.aside>
    </>
  );
}

/** One line to Cuso about this piece; he changes it and reschedules it. */
function ChangePiece({
  entry,
  onAsk,
}: {
  entry: Entry;
  onAsk: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [sent, setSent] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sending, startSending] = useTransition();
  if (sent)
    return (
      <p className="note sheet-sent">
        Sent. Cuso changes it and tells you in the chat.
      </p>
    );
  return (
    <form
      className="sheet-change"
      onSubmit={(event) => {
        event.preventDefault();
        const request = text.trim();
        if (!request) return;
        startSending(async () => {
          setFailed(false);
          try {
            await onAsk(
              `Change this piece: "${entry.title}" (${entry.channel}, ${entry.date}, id ${entry.id}). ${request}`,
            );
            setSent(true);
          } catch {
            setFailed(true);
          }
        });
      }}
    >
      <label className="label" htmlFor={`change-${entry.id}`}>
        Change this piece
      </label>
      <div className="sheet-change-row">
        <input
          id={`change-${entry.id}`}
          className="sheet-change-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="e.g. “Make it shorter and lead with the price”"
          maxLength={500}
          disabled={sending}
        />
        <button
          type="submit"
          className="button button-small"
          disabled={sending || !text.trim()}
        >
          {sending ? (
            <Loader2 size={14} className="spin" aria-hidden="true" />
          ) : null}
          Send
        </button>
      </div>
      {failed ? (
        <p className="note" role="alert">
          That didn't send. Try again.
        </p>
      ) : null}
    </form>
  );
}
