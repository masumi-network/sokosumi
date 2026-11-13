"use client";

import { ArrowRight, Check, ChevronDown, ChevronUp } from "lucide-react";
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
import type { StageId, StageMark, WorkingStatus } from "./brief";

interface StageBarProps {
  marks: StageMark[];
  /** The finished stage the page shows instead of the current one. */
  viewing?: StageId | null;
  /** Shows a finished stage, or the current one again. Unset: nothing to show. */
  onView?: ((id: StageId) => void) | undefined;
}

/** A finished stage or the current one has something to show. */
const viewable = (mark: StageMark) =>
  mark.state === "done" || mark.state === "now";

/** What a screen reader hears after a stage's name; the eye reads the style. */
const STATE_WORDS: Record<StageMark["state"], string> = {
  done: ", done",
  now: ", now",
  background: `, ${AGENT_NAME} works on it in the background`,
  next: ", not yet",
};

/**
 * The seven stages, in one slim row under the header that stays in view.
 * The style says the state: done ink, now Iris and bold, background dashed
 * with a green dot, ahead grey. Finished stages and the current one are
 * buttons that show their page; the one shown is underlined. On a phone the
 * row folds into the current stage and a strip, and drops down a sheet.
 */
export function StageBar({ marks, viewing = null, onView }: StageBarProps) {
  const at = marks.findIndex((mark) => mark.state === "now");
  const current = marks[at];
  const viewed = marks.find((mark) => mark.id === viewing);
  const [sheet, setSheet] = useState(false);
  const row = useRef<HTMLButtonElement>(null);
  const close = () => {
    setSheet(false);
    row.current?.focus();
  };
  const name = (mark: StageMark) => (
    <span className="brief-stage-label">
      {mark.state === "background" ? (
        <span className="dot live" aria-hidden="true" />
      ) : null}
      {mark.label}
    </span>
  );
  // The phone's line: the current stage and where it sits, or the one viewed.
  const line = (open: boolean) =>
    current ? (
      <>
        <span className="brief-stage-row-line">
          {viewed ? (
            <>
              <b className="brief-viewed">{viewed.label}</b>
              <span className="muted">viewing</span>
            </>
          ) : (
            <>
              <b>{current.label}</b>
              <span className="muted num">
                {at + 1} of {marks.length}
              </span>
            </>
          )}
          {onView ? (
            open ? (
              <ChevronUp size={16} aria-hidden="true" />
            ) : (
              <ChevronDown size={16} aria-hidden="true" />
            )
          ) : null}
        </span>
        <span className="brief-stage-strip" aria-hidden="true">
          {marks.map((mark) => (
            <span key={mark.id} className={mark.state} />
          ))}
        </span>
      </>
    ) : null;

  return (
    <>
      <nav className="brief-stages" aria-label="Your progress">
        <ol className="brief-stage-list">
          {marks.map((mark) => {
            const className = `brief-stage ${mark.state}${mark.id === viewing ? " viewed" : ""}`;
            const step = mark.state === "now" ? "step" : undefined;
            const words = (
              <>
                <span className="brief-stage-rule" aria-hidden="true" />
                {name(mark)}
                <span className="ob-sr">
                  {STATE_WORDS[mark.state]}
                  {mark.id === viewing ? ", viewing" : ""}
                </span>
              </>
            );
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
                    {words}
                  </button>
                ) : (
                  <div className={className} aria-current={step}>
                    {words}
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        {onView ? (
          <button
            ref={row}
            type="button"
            className="brief-stage-row"
            aria-haspopup="dialog"
            aria-expanded={sheet}
            onClick={() => setSheet(true)}
          >
            {line(false)}
          </button>
        ) : (
          <div className="brief-stage-row">{line(false)}</div>
        )}
        {sheet && onView ? (
          <StageSheet
            marks={marks}
            viewing={viewing}
            head={line(true)}
            onClose={close}
            onView={(id) => {
              onView(id);
              close();
            }}
          />
        ) : null}
      </nav>
      {sheet && onView ? (
        // Only catches clicks; the stage row on top of the sheet is the control.
        <div
          className="brief-sheet-backdrop"
          aria-hidden="true"
          onClick={close}
        />
      ) : null}
    </>
  );
}

interface StageSheetProps {
  marks: StageMark[];
  viewing: StageId | null;
  /** The stage line, drawn again on top of the sheet: pressing it closes. */
  head: ReactNode;
  onClose: () => void;
  onView: (id: StageId) => void;
}

/**
 * The seven stages as rows, dropped down from the phone's stage line, which
 * leaves the bottom to Cuso and the question. Esc, the backdrop or the line
 * closes it; Tab stays inside, and the page behind holds still.
 */
function StageSheet({
  marks,
  viewing,
  head,
  onClose,
  onView,
}: StageSheetProps) {
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
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
  };
  return (
    <div
      className="brief-sheet"
      role="dialog"
      aria-modal="true"
      aria-label="Your progress"
      onKeyDown={onKeyDown}
    >
      <button
        type="button"
        className="brief-stage-row"
        aria-expanded="true"
        onClick={onClose}
      >
        {head}
        <span className="ob-sr">, close</span>
      </button>
      <ol ref={list} className="brief-sheet-list">
        {marks.map((mark) => (
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
              <span className="brief-sheet-name">{mark.label}</span>
              <SheetMark mark={mark} viewed={mark.id === viewing} />
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The right of a sheet row: Viewing, Now, a check, a green dot, or nothing. */
function SheetMark({ mark, viewed }: { mark: StageMark; viewed: boolean }) {
  if (viewed) return <span className="brief-sheet-state">Viewing</span>;
  switch (mark.state) {
    case "now":
      return (
        <span className="brief-sheet-state">
          <span className="brief-now-dot" aria-hidden="true" />
          Now
        </span>
      );
    case "done":
      return (
        <span className="brief-sheet-state">
          <Check size={16} strokeWidth={2.5} role="img" aria-label="Done" />
        </span>
      );
    case "background":
      return (
        <span className="brief-sheet-state">
          <span className="dot live" aria-hidden="true" />
          <span className="ob-sr">{STATE_WORDS.background}</span>
        </span>
      );
    default:
      return <span className="ob-sr">{STATE_WORDS.next}</span>;
  }
}

/** What the dock shows: Cuso at work, a question for you, or live. */
export type BarMode =
  | { kind: "working"; status: WorkingStatus }
  | {
      kind: "asking";
      /** "2 of 4"; empty when one thing waits. */
      count: string;
      /** Later: leave this for now. Unset when it cannot wait (the website). */
      onLater?: (() => void) | undefined;
      /** The question, its answers and the free text field. */
      chat: ReactNode;
      /** Changes with each question, so focus moves to the new one. */
      askKey: string;
    }
  | { kind: "folded"; waiting: number; onOpen: () => void }
  | { kind: "live"; status: WorkingStatus; onGoToday: () => void };

interface BriefBarProps {
  pose: CusoPose;
  mode: BarMode;
}

/**
 * Cuso's dock at the bottom of every screen: what he is doing, the one thing
 * he needs, or that the month is live. One state at a time. The page shows;
 * this asks.
 */
export function BriefBar({ pose, mode }: BriefBarProps) {
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
      aria-label={AGENT_NAME}
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
            </>
          ) : mode.kind === "folded" ? (
            <>
              <p className="brief-state">
                <span className="brief-mark warn" aria-hidden="true">
                  !
                </span>
                <span>
                  <b>{AGENT_NAME} needs you</b>
                  {" · "}
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
            </>
          ) : mode.kind === "live" ? (
            <>
              <p className="brief-state">
                <span className="dot live" aria-hidden="true" />
                <b>You're live</b>
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
                <p className="brief-foot">{mode.status.foot}</p>
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
      </div>
    </footer>
  );
}
