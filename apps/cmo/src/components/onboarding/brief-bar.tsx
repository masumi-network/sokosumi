"use client";

import { ArrowRight, Check, ChevronUp, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";

import { AGENT_NAME } from "../../lib/agent";
import type { CusoPose } from "../../lib/thread";
import { CusoAvatar } from "../cuso";
import {
  NEXT_LINE,
  STAGES,
  type StageId,
  type StageMark,
  type WorkingStatus,
} from "./brief";

interface TimelineProps {
  marks: StageMark[];
  /** The finished stage the page shows instead of the current one. */
  viewing?: StageId | null;
  /** Shows a finished stage, or the current one again. Unset: nothing to show. */
  onView?: ((id: StageId) => void) | undefined;
}

/** A finished stage or the current one has something to show. */
const viewable = (mark: StageMark) =>
  mark.state === "done" || mark.state === "now";

const STATE_WORDS: Record<StageMark["state"], string> = {
  done: "Done",
  now: "Now",
  background: `${AGENT_NAME} works on it`,
  next: "Later",
};

/**
 * The seven stages. Done is ink, the current one Iris, work Cuso does behind
 * the current stage dashed. Finished stages and the current one are buttons
 * that show their page; the one shown is underlined. On a phone it folds
 * into one line that opens a sheet of the stages.
 */
export function Timeline({ marks, viewing = null, onView }: TimelineProps) {
  const at = marks.findIndex((mark) => mark.state === "now");
  const current = marks[at];
  const viewed = marks.find((mark) => mark.id === viewing);
  const [sheet, setSheet] = useState(false);
  const fold = useRef<HTMLButtonElement>(null);
  const close = () => {
    setSheet(false);
    fold.current?.focus();
  };
  const stageWords = (mark: StageMark, index: number) => (
    <>
      <span className="brief-stage-rule" aria-hidden="true" />
      <span className="brief-stage-label">
        {index + 1} {mark.label}
      </span>
      <span className="brief-stage-who">{mark.who}</span>
      <span className="ob-sr">
        {mark.state === "done"
          ? ", done"
          : mark.state === "now"
            ? ", now"
            : mark.state === "background"
              ? `, ${AGENT_NAME} works on it in the background`
              : ", not yet"}
        {mark.id === viewing ? ", viewing" : ""}
      </span>
    </>
  );
  const foldLine = current ? (
    <>
      <p className="brief-fold-line">
        <span>
          Step {at + 1} of {marks.length} · <b>{current.label}</b>
        </span>
        <span className="muted">
          {viewed ? `Viewing: ${viewed.label}` : NEXT_LINE[current.id]}
        </span>
        {onView ? (
          <ChevronUp
            size={16}
            className="brief-fold-chevron"
            aria-hidden="true"
          />
        ) : null}
      </p>
      {/* The step line is the label; the strip only draws it. */}
      <ol className="brief-fold-strip" aria-hidden="true">
        {marks.map((mark) => (
          <li key={mark.id} className={mark.state} />
        ))}
      </ol>
    </>
  ) : null;
  return (
    <>
      <ol className="brief-timeline" aria-label="Your progress">
        {marks.map((mark, index) => {
          const className = `brief-stage ${mark.state}${mark.id === viewing ? " viewed" : ""}`;
          const step = mark.state === "now" ? "step" : undefined;
          return (
            <li key={mark.id}>
              {onView ? (
                <button
                  type="button"
                  className={className}
                  aria-current={step}
                  disabled={!viewable(mark)}
                  aria-disabled={!viewable(mark) || undefined}
                  onClick={() => onView(mark.id)}
                >
                  {stageWords(mark, index)}
                </button>
              ) : (
                <div className={className} aria-current={step}>
                  {stageWords(mark, index)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {current && onView ? (
        <button
          ref={fold}
          type="button"
          className="brief-fold brief-fold-button"
          aria-haspopup="dialog"
          aria-expanded={sheet}
          onClick={() => setSheet(true)}
        >
          {foldLine}
        </button>
      ) : current ? (
        <div className="brief-fold">{foldLine}</div>
      ) : null}
      {sheet && onView ? (
        <StageSheet
          marks={marks}
          viewing={viewing}
          onClose={close}
          onView={(id) => {
            onView(id);
            close();
          }}
        />
      ) : null}
    </>
  );
}

interface StageSheetProps {
  marks: StageMark[];
  viewing: StageId | null;
  onClose: () => void;
  onView: (id: StageId) => void;
}

/** The seven stages as rows, from the phone's step line. Esc closes it. */
function StageSheet({ marks, viewing, onClose, onView }: StageSheetProps) {
  const list = useRef<HTMLOListElement>(null);
  // Focus starts on the stage shown (the one looked at, else the current
  // one), once: the overview polls, and a poll must not move focus.
  const [first] = useState(
    () => viewing ?? marks.find((mark) => mark.state === "now")?.id,
  );
  useEffect(() => {
    list.current
      ?.querySelector<HTMLButtonElement>(`[data-stage="${first}"]`)
      ?.focus();
  }, [first]);
  // The page behind holds still while the sheet is open.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);
  return (
    <>
      {/* The scrim only catches clicks; Close is the sheet's control. */}
      <div className="sheet-scrim" aria-hidden="true" onClick={onClose} />
      <div
        className="brief-sheet card-focus"
        role="dialog"
        aria-modal="true"
        aria-label="Your progress"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
            return;
          }
          if (event.key !== "Tab") return;
          // Tab wraps inside the sheet: its live buttons are the only stops.
          const stops = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          ];
          const edge = event.shiftKey ? stops[0] : stops.at(-1);
          const wrap = event.shiftKey ? stops.at(-1) : stops[0];
          if (document.activeElement !== edge) return;
          event.preventDefault();
          wrap?.focus();
        }}
      >
        <div className="brief-sheet-head">
          <p className="brief-result-head">Your progress</p>
          <button
            type="button"
            className="sheet-close"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <ol ref={list} className="brief-sheet-list">
          {marks.map((mark, index) => (
            <li key={mark.id}>
              <button
                type="button"
                data-stage={mark.id}
                className={`brief-sheet-row ${mark.state}${mark.id === viewing ? " viewed" : ""}`}
                aria-current={mark.state === "now" ? "step" : undefined}
                disabled={!viewable(mark)}
                aria-disabled={!viewable(mark) || undefined}
                onClick={() => onView(mark.id)}
              >
                <span className="brief-sheet-name">
                  <b>
                    {index + 1} {mark.label}
                  </b>
                  <span className="muted">
                    {STAGES.find((stage) => stage.id === mark.id)?.who}
                  </span>
                </span>
                <span className="brief-sheet-state">
                  {mark.id === viewing ? "Viewing" : STATE_WORDS[mark.state]}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </div>
    </>
  );
}

/** What the bar shows: Cuso at work, a question for you, or done. */
export type BarMode =
  | { kind: "working"; status: WorkingStatus }
  | {
      kind: "asking";
      /** "1 of 4", "briefing 2 of 4", "fix 1". */
      count: string;
      /** Later: leave this for now. Unset when it cannot wait (the website). */
      onLater?: (() => void) | undefined;
      meanwhile: string | null;
      /** The question, its answers and the free text field. */
      chat: ReactNode;
      /** Changes with each question, so focus moves to the new one. */
      askKey: string;
    }
  | {
      kind: "folded";
      waiting: number;
      onOpen: () => void;
      meanwhile: string | null;
    }
  | { kind: "live"; status: WorkingStatus; onGoToday: () => void };

interface BriefBarProps {
  marks: StageMark[];
  pose: CusoPose;
  mode: BarMode;
  /** The finished stage the page shows, and how to show another. */
  viewing?: StageId | null;
  onView?: ((id: StageId) => void) | undefined;
}

/**
 * The bar at the bottom of every screen: a big Cuso, what he is doing or the
 * one thing he needs, and the seven stages. The page shows; this asks.
 */
export function BriefBar({
  marks,
  pose,
  mode,
  viewing = null,
  onView,
}: BriefBarProps) {
  const chat = useRef<HTMLElement>(null);
  const askKey = mode.kind === "asking" ? mode.askKey : null;
  // Focus moves to the question when the chat opens or moves on.
  useEffect(() => {
    if (!askKey) return;
    // A heading, focused for screen readers: no ring, since nothing on it
    // can be pressed (the guards keep outlines; the browser skips this one).
    chat.current
      ?.querySelector<HTMLElement>("[data-brief-question]")
      ?.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
  }, [askKey]);
  // Esc folds the chat away, from inside the chat only: a sheet on the page
  // closes on its own Esc, and a field with words in it keeps them.
  const onLater = mode.kind === "asking" ? (mode.onLater ?? null) : null;
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Escape" || event.defaultPrevented || !onLater) return;
    const field = event.target;
    if (
      (field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement) &&
      field.value
    ) {
      return;
    }
    onLater();
  };

  return (
    <footer
      className={`brief-bar brief-bar-${mode.kind}`}
      aria-label={`${AGENT_NAME} and your progress`}
    >
      <div className="brief-bar-inner">
        <div className="brief-cuso">
          <CusoAvatar pose={pose} size={96} />
        </div>
        <section
          ref={chat}
          className="brief-bar-body"
          onKeyDown={onKeyDown}
          aria-label={
            mode.kind === "asking" ? `${AGENT_NAME} needs you` : undefined
          }
        >
          {mode.kind === "asking" ? (
            <>
              <p className="brief-state">
                <span className="brief-mark warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <b>{AGENT_NAME} needs you</b>
                  {mode.count ? ` · ${mode.count}` : ""}
                </span>
                {mode.onLater ? (
                  <button
                    type="button"
                    className="brief-later"
                    onClick={mode.onLater}
                  >
                    Later
                  </button>
                ) : null}
              </p>
              <div className="brief-chat">{mode.chat}</div>
              {mode.meanwhile ? (
                <p className="brief-meanwhile">
                  <span className="dot live" aria-hidden="true" />
                  {mode.meanwhile}
                </p>
              ) : null}
            </>
          ) : mode.kind === "folded" ? (
            <>
              <p className="brief-state">
                <span className="brief-mark warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <b>{AGENT_NAME} needs you</b> ·{" "}
                  {mode.waiting === 1
                    ? "1 thing waits"
                    : `${mode.waiting} things wait`}
                </span>
              </p>
              <button
                type="button"
                className="button button-secondary button-small brief-open"
                onClick={mode.onOpen}
              >
                Open
              </button>
              {mode.meanwhile ? (
                <p className="brief-meanwhile">
                  <span className="dot live" aria-hidden="true" />
                  {mode.meanwhile}
                </p>
              ) : null}
            </>
          ) : mode.kind === "live" ? (
            <>
              <p className="brief-state">
                <span className="brief-mark ok" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
                <span>
                  <b>You're live</b>
                  {mode.status.count ? ` · ${mode.status.count}` : ""}
                </span>
              </p>
              <div className="brief-live-row">
                <p className="brief-title">{mode.status.title}</p>
                <button
                  type="button"
                  className="button"
                  onClick={mode.onGoToday}
                >
                  Go to Today
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <div className="brief-working">
              <p className="brief-state">
                <span className="dot live" aria-hidden="true" />
                <span>
                  <b>{AGENT_NAME} is working</b>
                  {mode.status.count ? ` · ${mode.status.count}` : ""}
                </span>
              </p>
              <p className="brief-title">{mode.status.title}</p>
              {mode.status.now ? (
                <p className="brief-now">{mode.status.now}</p>
              ) : null}
              {mode.status.foot ? (
                <p className="brief-foot muted">{mode.status.foot}</p>
              ) : null}
            </div>
          )}
        </section>
        {/* Always mounted, so screen readers hear each new working line. */}
        <p className="ob-sr" role="status" aria-live="polite">
          {mode.kind === "working"
            ? [mode.status.title, mode.status.now].filter(Boolean).join(". ")
            : ""}
        </p>
        <div className="brief-bar-timeline">
          <Timeline marks={marks} viewing={viewing} onView={onView} />
        </div>
      </div>
    </footer>
  );
}
