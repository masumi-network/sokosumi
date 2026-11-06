"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { Check, ChevronRight, X } from "lucide-react";
import { type ReactNode, useEffect, useState, useTransition } from "react";

import { AGENT_NAME } from "../../lib/agent";
import { SubmitButton } from "../submit-button";
import { Refusal } from "./refusal";
import { STEPS } from "./step";

export { AGENT_NAME };

export type Pose = "reading" | "thinking" | "needs-you" | "reporting" | "done";

interface CusoAvatarProps {
  pose: Pose;
  size?: 36 | 48 | 96;
}

/** Cuso's pose on his light circle: the status of the screen. */
export function CusoAvatar({ pose, size = 48 }: CusoAvatarProps) {
  return (
    <span className="ob-avatar" style={{ width: size, height: size }}>
      <img src={`/cuso/${pose}.png`} alt="" width={size} height={size} />
    </span>
  );
}

/**
 * The four steps in the header. `reached` is where Cuso has got to; `current`
 * is the one on screen, which differs while the founder looks back. `open`
 * says which markers lead somewhere.
 */
interface StepMarkersProps {
  current: number;
  reached: number;
  open?: (index: number) => (() => void) | null;
}

export function StepMarkers({ current, reached, open }: StepMarkersProps) {
  return (
    <ol className="ob-steps" aria-label="Onboarding">
      {STEPS.map((step, index) => {
        const state =
          index === current ? "now" : index < reached ? "done" : "next";
        const action = index === current ? null : (open?.(index) ?? null);
        const content = (
          <>
            {state === "done" ? (
              <Check size={12} strokeWidth={3} aria-hidden="true" />
            ) : (
              <span aria-hidden="true">{index + 1}</span>
            )}
            {step.label}
          </>
        );
        return (
          <li
            key={step.id}
            className={`ob-step ${state}`}
            aria-current={state === "now" ? "step" : undefined}
          >
            {action ? (
              <button type="button" onClick={action}>
                {content}
              </button>
            ) : (
              <span>{content}</span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Done (green, check), working (dashed, dot) or not yet (hairline). */
interface ChecklistItem {
  label: string;
  state: "done" | "working" | "next";
}

interface ChecklistProps {
  items: ChecklistItem[];
}

export function Checklist({ items }: ChecklistProps) {
  return (
    <ol className="ob-checklist">
      {items.map((item) => (
        <li key={item.label} className={item.state}>
          <span className="ob-box" aria-hidden="true">
            {item.state === "done" ? (
              <Check size={12} strokeWidth={3} />
            ) : item.state === "working" ? (
              <span className="ob-box-dot" />
            ) : null}
          </span>
          {item.label}
          <span className="ob-sr">
            {item.state === "done"
              ? ", done"
              : item.state === "working"
                ? ", in progress"
                : ", not yet"}
          </span>
        </li>
      ))}
    </ol>
  );
}

type Work = NonNullable<CmoOverview["work"]>;

/** "4 min so far": the time since the work started, ticking while it runs. */
export function useElapsed(
  since: Date | string | undefined,
  running: boolean,
): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!running || !since) return null;
  const seconds = Math.max(
    0,
    Math.round((now - new Date(since).getTime()) / 1_000),
  );
  return seconds < 60
    ? `${seconds}s so far`
    : `${Math.floor(seconds / 60)} min so far`;
}

export const RESEARCH_PHASES = [
  { kinds: ["read"], label: "Reading your site" },
  { kinds: ["search", "study"], label: "Comparing your competitors" },
  { kinds: ["brain"], label: "Writing your Brand Brain" },
] as const;

export const PLANNING_PHASES = [
  { kinds: ["other"], label: "Your channels" },
  { kinds: ["strategy"], label: "Four weeks, day by day" },
] as const;

/**
 * The work's steps as a checklist. A phase is done once a later one has
 * started, even when Cuso skipped it (no channels to check), so no step
 * stays unticked behind the active one.
 */
export function workChecklist(
  steps: Work["steps"],
  phases: readonly { kinds: readonly string[]; label: string }[],
  running: boolean,
): ChecklistItem[] {
  const touched = (at: number) =>
    steps.filter((step) => phases[at]?.kinds.includes(step.kind));
  return phases.map((phase, index) => {
    const mine = touched(index);
    const laterStarted = phases
      .slice(index + 1)
      .some((_, offset) => touched(index + 1 + offset).length > 0);
    const state: ChecklistItem["state"] = laterStarted
      ? "done"
      : mine.some((step) => step.status === "running")
        ? "working"
        : mine.length > 0
          ? index === phases.length - 1 && running
            ? "working"
            : "done"
          : "next";
    return { label: phase.label, state };
  });
}

/** A section Cuso has not saved yet: a dashed outline, never a shimmer. */
export function SkeletonTile() {
  return (
    <div className="ob-skeleton" aria-hidden="true">
      <span />
      <span />
    </div>
  );
}

interface StatusDiscProps {
  status: "ok" | "warn" | "fail";
}

/** Done: green disc and check. Needs you: yellow disc and "!". Failed: ink disc and X. */
export function StatusDisc({ status }: StatusDiscProps) {
  const label =
    status === "ok"
      ? "Done"
      : status === "warn"
        ? "Needs your answer"
        : "Failed";
  return (
    <span role="img" aria-label={label} className={`ob-disc ob-disc-${status}`}>
      <span aria-hidden="true">
        {status === "ok" ? (
          <Check size={12} strokeWidth={3} />
        ) : status === "warn" ? (
          "!"
        ) : (
          <X size={12} strokeWidth={3} />
        )}
      </span>
    </span>
  );
}

interface StatRowProps {
  stats: { value: string; line: string }[];
}

/** Big numbers over a small line, set off by a top line. */
export function StatRow({ stats }: StatRowProps) {
  return (
    <dl className="ob-stats">
      {stats.map((stat) => (
        <div key={stat.value}>
          <dt>{stat.value}</dt>
          <dd>{stat.line}</dd>
        </div>
      ))}
    </dl>
  );
}

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
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside className="ob-side card" aria-label={title}>
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

/**
 * An assumption Cuso made, sitting on the line it changes: the question, a
 * small Yes and a text alternative.
 */
interface AssumptionChipProps {
  question: string;
  yes: { label?: string; pressed?: boolean; onClick: () => void };
  other: { label?: string; pressed?: boolean; onClick: () => void };
  /** A third answer, as a text button. */
  unsure?: { pressed?: boolean; onClick: () => void };
  /** Below the chip: a note field after a No. */
  children?: ReactNode;
}

export function AssumptionChip({
  question,
  yes,
  other,
  unsure,
  children,
}: AssumptionChipProps) {
  return (
    <div className="ob-chip">
      <div className="ob-chip-row">
        <StatusDisc status="warn" />
        <p className="ob-chip-question">{question}</p>
        <div className="ob-chip-actions">
          <button
            type="button"
            className="button button-secondary button-small"
            aria-pressed={yes.pressed ?? false}
            onClick={yes.onClick}
          >
            {yes.label ?? "Yes"}
          </button>
          <button
            type="button"
            className="button button-ghost button-small"
            aria-pressed={other.pressed ?? false}
            onClick={other.onClick}
          >
            {other.label ?? "No"}
          </button>
          {unsure ? (
            <button
              type="button"
              className="button button-ghost button-small"
              aria-pressed={unsure.pressed ?? false}
              onClick={unsure.onClick}
            >
              Not sure
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export type Answer = "yes" | "no" | "unsure";
type AnswerSaver = (
  questionId: string,
  answer: Answer,
  note?: string,
) => Promise<void>;
type Picked = { answer: Answer; note?: string };

/**
 * Answers show the moment they are tapped; the save follows. A failed save
 * takes the tap back. Next.js runs server actions one at a time, so a plan
 * requested right after a tap still reads every answer.
 */
export function useAnswers<
  Q extends { id: string; answer?: Answer; note?: string },
>(questions: Q[], onAnswer: AnswerSaver): [Q[], AnswerSaver] {
  const [picks, setPicks] = useState<Record<string, Picked>>({});
  const shown = questions.map((question) => {
    const pick = picks[question.id];
    return pick
      ? { ...question, answer: pick.answer, note: pick.note }
      : question;
  });
  const save: AnswerSaver = async (questionId, answer, note) => {
    const pick: Picked = { answer, note };
    const settle = () =>
      setPicks((current) => {
        if (current[questionId] !== pick) return current;
        const { [questionId]: _settled, ...rest } = current;
        return rest;
      });
    setPicks((current) => ({ ...current, [questionId]: pick }));
    try {
      await onAnswer(questionId, answer, note);
    } finally {
      settle();
    }
  };
  return [shown, save];
}

interface NoteFieldProps {
  initial: string;
  onSave: (note: string) => void;
}

/** A no opens a line for what is true instead; it saves with the no. */
export function NoteField({ initial, onSave }: NoteFieldProps) {
  const [note, setNote] = useState(initial);
  return (
    <form className="ob-note-form" action={() => onSave(note)}>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="What's true instead? (optional)"
        maxLength={400}
        aria-label="What's true instead"
        autoFocus
      />
      <SubmitButton className="button button-secondary button-small">
        Save
      </SubmitButton>
    </form>
  );
}

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

/**
 * Cuso's questions, one at a time: where the founder is in them, the topic,
 * the question, and Yes, No or Not sure. A no can say what is true instead.
 */
interface QuestionCardProps {
  topic: string;
  question: { question: string; answer?: Answer; note?: string };
  index: number;
  /** Whether each question has an answer, for the progress segments. */
  answered: boolean[];
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
  onSkip?: () => void;
}

export function QuestionCard({
  topic,
  question,
  index,
  answered,
  onAnswer,
  onSkip,
}: QuestionCardProps) {
  const [correcting, setCorrecting] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = (answer: Answer, note?: string) => {
    setFailed(false);
    setCorrecting(false);
    onAnswer(answer, note).catch(() => setFailed(true));
  };
  const chosen = correcting ? "no" : question.answer;

  return (
    <section className="ob-question card" aria-label="Quick read">
      <div className="ob-question-head">
        <span className="ob-question-title">Quick read</span>
        <span className="ob-question-count num">
          {index + 1} of {answered.length}
        </span>
      </div>
      <ol className="ob-progress" aria-hidden="true">
        {answered.map((done, at) => (
          <li
            // The questions are fixed for the read; their place is the key.
            key={at}
            className={at === index ? "now" : done ? "done" : "next"}
          />
        ))}
      </ol>
      <p className="ob-question-topic">{topic}</p>
      <p className="ob-question-text">{question.question}</p>
      <div className="ob-answers" role="group" aria-label="Your answer">
        {ANSWERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className="button button-secondary"
            aria-pressed={chosen === value}
            onClick={() => (value === "no" ? setCorrecting(true) : save(value))}
          >
            {label}
          </button>
        ))}
      </div>
      {correcting ? (
        <NoteField
          initial={question.note ?? ""}
          onSave={(note) => save("no", note)}
        />
      ) : question.answer === "no" && question.note ? (
        <p className="ob-question-said">{question.note}</p>
      ) : null}
      {failed ? (
        <p className="alert" role="alert">
          That didn't save. Try again.
        </p>
      ) : null}
      {onSkip ? (
        <button
          type="button"
          className="button button-ghost button-small ob-skip"
          onClick={onSkip}
        >
          Skip for now
        </button>
      ) : null}
    </section>
  );
}

interface RetryButtonProps {
  onRetry: () => Promise<string | null>;
  topUpUrl: string;
}

/** Starts the work again; a refusal (such as no credits) comes back as text. */
export function RetryButton({ onRetry, topUpUrl }: RetryButtonProps) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="ob-retry">
      <button
        type="button"
        className="button button-secondary"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setRefusal(await onRetry());
          })
        }
      >
        {pending ? "Starting…" : "Try again"}
      </button>
      {refusal ? <Refusal text={refusal} topUpUrl={topUpUrl} /> : null}
    </div>
  );
}
