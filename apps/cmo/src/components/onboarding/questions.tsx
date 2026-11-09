"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";

import { StatusDisc } from "../status";
import { SubmitButton } from "../submit-button";
import { Refusal } from "./refusal";

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
    <section className="ob-question card card-focus" aria-label="Quick read">
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
