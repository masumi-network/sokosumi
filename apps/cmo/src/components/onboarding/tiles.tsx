"use client";

import { ChevronRight, X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { useEventListener } from "../../hooks/effects/use-event-listener";
import { useSidePanelFocus } from "../../hooks/effects/use-side-panel-focus";

interface GoalBlockProps {
  label: string;
  /** The short goal: the screen's one H1 when `headline` is set. */
  goal: string;
  /** The long sentence under it, in the muted inverted colour. */
  statement?: string;
  headline?: boolean;
  facts: { term: string; value: ReactNode }[];
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
  value: ReactNode;
  detail?: ReactNode;
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

/** A sheet that rises from the bottom. Escape or a press outside closes it. */
export function SidePanel({
  title,
  onClose,
  source,
  sourceUrl,
  children,
}: SidePanelProps) {
  const sheet = useRef<HTMLElement>(null);
  // The sheet takes the focus it was opened for, and gives it back.
  useSidePanelFocus(sheet);
  useEventListener("window", "keydown", (event) => {
    if (event.key !== "Escape") return;
    onClose();
  });
  // A press outside closes it; a row's own press swaps or closes it itself.
  useEventListener("window", "pointerdown", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (sheet.current?.contains(target) || target.closest(".ob-tile")) return;
    onClose();
  });
  return (
    <aside
      ref={sheet}
      className="ob-side card"
      aria-label={title}
      tabIndex={-1}
    >
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
