"use client";

import { ArrowRight, Check } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useEffect, useRef } from "react";

import { AGENT_NAME } from "../../lib/agent";
import type { CusoPose } from "../../lib/thread";
import { CusoAvatar } from "../cuso";
import { NEXT_LINE, type StageMark, type WorkingStatus } from "./brief";

interface TimelineProps {
  marks: StageMark[];
}

/**
 * The seven stages. Done is ink, the current one Iris, work Cuso does behind
 * the current stage dashed. On a phone it folds into one line.
 */
export function Timeline({ marks }: TimelineProps) {
  const at = marks.findIndex((mark) => mark.state === "now");
  const current = marks[at];
  return (
    <>
      <ol className="brief-timeline" aria-label="Your progress">
        {marks.map((mark, index) => (
          <li
            key={mark.id}
            className={`brief-stage ${mark.state}`}
            aria-current={mark.state === "now" ? "step" : undefined}
          >
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
            </span>
          </li>
        ))}
      </ol>
      {current ? (
        <p className="brief-fold">
          <span>
            Step {at + 1} of {marks.length} · <b>{current.label}</b>
          </span>
          <span className="muted">{NEXT_LINE[current.id]}</span>
        </p>
      ) : null}
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
}

/**
 * The bar at the bottom of every screen: a big Cuso, what he is doing or the
 * one thing he needs, and the seven stages. The page shows; this asks.
 */
export function BriefBar({ marks, pose, mode }: BriefBarProps) {
  const chat = useRef<HTMLElement>(null);
  const askKey = mode.kind === "asking" ? mode.askKey : null;
  // Focus moves to the question when the chat opens or moves on.
  useEffect(() => {
    if (!askKey) return;
    chat.current
      ?.querySelector<HTMLElement>("[data-brief-question]")
      ?.focus({ preventScroll: true });
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
          <Timeline marks={marks} />
        </div>
      </div>
    </footer>
  );
}
