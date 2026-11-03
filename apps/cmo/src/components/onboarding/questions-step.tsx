"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { BRAND_SECTIONS, type BrandBrain } from "../../lib/brand-sections";
import { Refusal } from "./refusal";
import { StepHead } from "./step-head";

type Question = NonNullable<BrandBrain["questions"]>[number];
export type Answer = NonNullable<Question["answer"]>;
/** A yes/no question, from the Brand Brain or the plan. */
type YesNoQuestion = Pick<Question, "id" | "question" | "answer" | "note">;
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
export function useAnswers<Q extends YesNoQuestion>(
  questions: Q[],
  onAnswer: AnswerSaver,
): [Q[], AnswerSaver] {
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

const ANSWERS: { value: Answer; label: string }[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
  { value: "unsure", label: "Not sure" },
];

interface QuestionsStepProps {
  overview: CmoOverview;
  onAnswer: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  onPlan: () => Promise<string | null>;
  /** Set when the founder opened this step again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
}

/**
 * What research could not settle, one tap each. A yes confirms what Cuso
 * read, a no can say what is true instead; both go into the Brand Brain
 * before he plans.
 */
export function QuestionsStep({
  overview,
  onAnswer,
  onPlan,
  ahead,
}: QuestionsStepProps) {
  const [questions, answer] = useAnswers(
    (overview.brandBrain as BrandBrain | null)?.questions ?? [],
    onAnswer,
  );
  const answered = questions.filter((question) => question.answer).length;
  const [planning, startPlanning] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const done = answered === questions.length;
  // A no waits for Cuso to rewrite its section; opened again after the plan,
  // the step sends him to fix it instead of moving on.
  const corrections = questions.filter(
    (question) => question.answer === "no" && question.corrected === false,
  ).length;
  const lead = corrections > 0 ? undefined : ahead;

  return (
    <section className="ob-questions">
      <StepHead
        step={3}
        title="Questions"
        mood="point"
        say={
          !done
            ? "A few things I couldn't confirm. Yes or no is enough."
            : corrections > 0
              ? `Thanks. I'll fix what I got wrong in your Brand Brain, then ${ahead ? "update" : "plan"} your month.`
              : ahead
                ? "That's everything I needed. Your plan is built on it."
                : "That's everything I needed. Now I plan your month."
        }
        note={
          questions.length > 0
            ? `${answered} of ${questions.length} answered`
            : undefined
        }
        action={
          lead ? (
            <button
              type="button"
              className="ob-button ob-button-lg"
              onClick={lead.onClick}
            >
              Continue to {lead.label}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              className={
                done
                  ? "ob-button ob-button-lg"
                  : "ob-button ob-button-quiet ob-button-lg"
              }
              disabled={planning}
              onClick={() =>
                startPlanning(async () => {
                  setRefusal(await onPlan());
                })
              }
            >
              {planning ? (
                <>
                  <Loader2 size={16} className="ob-spin" aria-hidden="true" />
                  Starting…
                </>
              ) : (
                <>
                  {ahead
                    ? "Fix it and update my plan"
                    : done
                      ? "Plan my month"
                      : "Skip, plan my month"}
                  <ArrowRight size={16} aria-hidden="true" />
                </>
              )}
            </button>
          )
        }
      />
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
      <ol className="ob-qlist">
        {questions.map((question, index) => (
          <QuestionCard
            key={question.id}
            question={question}
            label={BRAND_SECTIONS[question.section].title}
            number={index + 1}
            onAnswer={(value, note) => answer(question.id, value, note)}
          />
        ))}
      </ol>
    </section>
  );
}

export function QuestionCard({
  question,
  label,
  number,
  onAnswer,
}: {
  question: YesNoQuestion;
  /** What the question is about, above it. */
  label: string;
  number: number;
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
}) {
  // A no opens a line for what is true instead; it saves with the no.
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState(question.note ?? "");
  const [failed, setFailed] = useState(false);
  const save = (answer: Answer, withNote?: string) => {
    setFailed(false);
    setCorrecting(false);
    onAnswer(answer, withNote).catch(() => setFailed(true));
  };
  const chosen = correcting ? "no" : question.answer;

  return (
    <li className={question.answer ? "ob-q answered" : "ob-q"}>
      <p className="ob-q-meta">
        <span className="ob-dot" aria-hidden="true">
          {question.answer ? <Check size={11} strokeWidth={3} /> : number}
        </span>
        {label}
      </p>
      <p className="ob-q-text">{question.question}</p>
      <div className="ob-q-answers" role="group" aria-label="Your answer">
        {ANSWERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={chosen === value ? "ob-answer selected" : "ob-answer"}
            aria-pressed={chosen === value}
            onClick={() => (value === "no" ? setCorrecting(true) : save(value))}
          >
            {label}
          </button>
        ))}
      </div>
      {correcting ? (
        <form
          className="ob-q-note"
          onSubmit={(event) => {
            event.preventDefault();
            save("no", note);
          }}
        >
          <input
            className="ob-input"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What's true instead? (optional)"
            maxLength={400}
            aria-label="What's true instead"
            autoFocus
          />
          <button type="submit" className="ob-button">
            Save
          </button>
        </form>
      ) : question.answer === "no" && question.note ? (
        <p className="ob-q-said">{question.note}</p>
      ) : null}
      {failed ? (
        <p className="ob-alert" role="alert">
          That didn't save. Try again.
        </p>
      ) : null}
    </li>
  );
}
