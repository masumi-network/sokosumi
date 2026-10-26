"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Clock, Lightbulb, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect } from "react";

import { channelLabel, formatDay } from "../lib/calendar";
import { formatHasImage, formatName } from "../lib/channels";
import { ChannelIcon } from "./channel-icon";
import { DraftText } from "./draft-text";
import { withoutLabel } from "./showcases";

type Entry = NonNullable<CmoOverview["strategy"]>["calendar"][number];

/**
 * One planned piece in a side sheet: when and where it goes out, the full
 * text, and why it is in the plan. Wrap it in AnimatePresence.
 */
export function EntrySheet({
  entry,
  onClose,
}: {
  entry: Entry;
  onClose: () => void;
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
            {formatHasImage(entry.channel, entry.format)
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
              Cuso writes it three days before it goes out.
            </p>
          </>
        )}
        {entry.why ? (
          <div className="sheet-why">
            <Lightbulb size={15} aria-hidden="true" />
            <p>{entry.why}</p>
          </div>
        ) : null}
      </motion.aside>
    </>
  );
}
