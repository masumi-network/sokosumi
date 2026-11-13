"use client";

import { ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";

interface GoalBlockProps {
  label: string;
  /** The short goal: the screen's one H1 when `headline` is set. */
  goal: string;
  /** The long sentence under it, in the muted inverted colour. */
  statement?: string;
  headline?: boolean;
  facts: { term: string; value: string }[];
}

/** The plan's goal: an ink block that inverts again in dark. */
export function GoalBlock({
  label,
  goal,
  statement,
  headline = false,
  facts,
}: GoalBlockProps) {
  return (
    <section className="ob-goal" aria-label={label}>
      <p className="ob-goal-label">{label}</p>
      {headline ? (
        <h1 className="ob-goal-headline">{goal}</h1>
      ) : (
        <p className="ob-goal-text">{goal}</p>
      )}
      {statement ? <p className="ob-goal-statement">{statement}</p> : null}
      {facts.length > 0 ? (
        <dl className="ob-goal-facts">
          {facts.map((fact) => (
            <div key={fact.term}>
              <dt>{fact.term}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

interface TileProps {
  label: string;
  /** A short state beside the label, such as "Fixed by you". */
  mark?: string;
  value: string;
  detail?: string;
  source?: string;
  open?: boolean;
  onToggle?: () => void;
}

/**
 * One idea from the Brand Brain. The whole card is the button that opens its
 * side panel; the open one keeps an Iris shadow.
 */
export function Tile({
  label,
  mark,
  value,
  detail,
  source,
  open,
  onToggle,
}: TileProps) {
  return (
    <button
      type="button"
      className={open ? "ob-tile open" : "ob-tile"}
      aria-expanded={open ?? false}
      onClick={onToggle}
    >
      <span className="ob-tile-head">
        <span className="ob-tile-label">{label}</span>
        {mark ? <span className="ob-tile-mark">{mark}</span> : null}
        <ChevronRight size={16} aria-hidden="true" className="ob-tile-go" />
      </span>
      <span className="ob-tile-value">{value}</span>
      {detail ? <span className="ob-tile-detail">{detail}</span> : null}
      {source ? <span className="ob-tile-source">{source}</span> : null}
    </button>
  );
}

interface SidePanelProps {
  title: string;
  onClose: () => void;
  source?: string;
  /** Makes the source a link. */
  sourceUrl?: string;
  children: ReactNode;
}

/** A card beside the grid; under 768px a bottom sheet. Escape closes it. */
export function SidePanel({
  title,
  onClose,
  source,
  sourceUrl,
  children,
}: SidePanelProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="ob-side card card-focus" aria-label={title}>
      <div className="ob-side-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="ob-side-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>
      <div className="ob-side-body">{children}</div>
      {source ? (
        <p className="ob-side-source">
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noreferrer">
              {source}
            </a>
          ) : (
            source
          )}
        </p>
      ) : null}
    </aside>
  );
}
