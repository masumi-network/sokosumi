"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";

import { BRAND_SECTIONS, type BrandBrain } from "../../lib/brand-sections";
import { Refusal } from "./refusal";
import { StepHead } from "./step-head";

type Question = NonNullable<BrandBrain["questions"]>[number];
type Answer = NonNullable<Question["answer"]>;

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
  const questions = (overview.brandBrain as BrandBrain | null)?.questions ?? [];
  const answered = questions.filter((question) => question.answer).length;
  const [planning, startPlanning] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const done = answered === questions.length;

  return (
    <section className="ob-questions">
      <StepHead
        step={3}
        title="Questions"
        mood="point"
        say={
          done
            ? "That's everything I needed. Now I plan your month."
            : "A few things I couldn't confirm. Yes or no is enough."
        }
        note={
          questions.length > 0
            ? `${answered} of ${questions.length} answered`
            : undefined
        }
        action={
          ahead ? (
            <button
              type="button"
              className="ob-button ob-button-lg"
              onClick={ahead.onClick}
            >
              Continue to {ahead.label}
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
                  {done ? "Plan my month" : "Skip, plan my month"}
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
            number={index + 1}
            onAnswer={(answer, note) => onAnswer(question.id, answer, note)}
          />
        ))}
      </ol>
    </section>
  );
}

function QuestionCard({
  question,
  number,
  onAnswer,
}: {
  question: Question;
  number: number;
  onAnswer: (answer: Answer, note?: string) => Promise<void>;
}) {
  const [saving, startSaving] = useTransition();
  // A no opens a line for what is true instead; it saves with the no.
  const [correcting, setCorrecting] = useState(false);
  const [note, setNote] = useState(question.note ?? "");
  const [failed, setFailed] = useState(false);
  const save = (answer: Answer, withNote?: string) =>
    startSaving(async () => {
      setFailed(false);
      try {
        await onAnswer(answer, withNote);
        setCorrecting(false);
      } catch {
        setFailed(true);
      }
    });
  const chosen = correcting ? "no" : question.answer;

  return (
    <li className={question.answer ? "ob-q answered" : "ob-q"}>
      <p className="ob-q-meta">
        <span className="ob-dot" aria-hidden="true">
          {question.answer ? <Check size={11} strokeWidth={3} /> : number}
        </span>
        {BRAND_SECTIONS[question.section].title}
      </p>
      <p className="ob-q-text">{question.question}</p>
      <div className="ob-q-answers" role="group" aria-label="Your answer">
        {ANSWERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            className={chosen === value ? "ob-answer selected" : "ob-answer"}
            aria-pressed={chosen === value}
            disabled={saving}
            onClick={() => (value === "no" ? setCorrecting(true) : save(value))}
          >
            {label}
          </button>
        ))}
        {saving ? (
          <Loader2 size={16} className="ob-spin" aria-label="Saving" />
        ) : null}
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
          <button type="submit" className="ob-button" disabled={saving}>
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
