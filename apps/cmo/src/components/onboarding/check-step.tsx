"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useState, useTransition } from "react";
import { APPROVED_BY_OWNERS } from "../../lib/approvers";
import { type Answer, QuestionCard } from "./questions-step";
import { Refusal } from "./refusal";
import { StepHead } from "./step-head";

type Strategy = NonNullable<CmoOverview["strategy"]>;

interface CheckStepProps {
  overview: CmoOverview;
  onAnswer: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  /** A no changed something: Cuso fits the plan to the answers. */
  onUpdate: () => Promise<string | null>;
  onApprove: () => Promise<void>;
}

/**
 * After the plan, Cuso's few assumptions, one tap each. All yes and the plan
 * is approved as it stands; a no sends it back to Cuso to fit the answer.
 */
export function CheckStep({
  overview,
  onAnswer,
  onUpdate,
  onApprove,
}: CheckStepProps) {
  const questions = (overview.strategy as Strategy).questions ?? [];
  const answered = questions.filter((question) => question.answer).length;
  const changes = questions.some((question) => question.answer === "no");
  const [going, startGoing] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);

  return (
    <section className="ob-questions">
      <StepHead
        step={5}
        title="Check"
        mood="point"
        say={
          changes
            ? "Thanks. I'll fit the plan to your answers, then you approve it."
            : "A few things I assumed while planning. Yes or no is enough."
        }
        note={
          questions.length > 0
            ? `${answered} of ${questions.length} answered`
            : undefined
        }
        action={
          !changes && !overview.viewerCanApprove ? (
            <p className="ob-note">{APPROVED_BY_OWNERS}</p>
          ) : (
            <button
              type="button"
              className={
                answered === questions.length
                  ? "ob-button ob-button-lg"
                  : "ob-button ob-button-quiet ob-button-lg"
              }
              disabled={going}
              onClick={() =>
                startGoing(async () => {
                  if (changes) setRefusal(await onUpdate());
                  else await onApprove();
                })
              }
            >
              {going ? (
                <Loader2 size={16} className="ob-spin" aria-hidden="true" />
              ) : changes ? (
                <ArrowRight size={16} aria-hidden="true" />
              ) : (
                <Check size={16} aria-hidden="true" />
              )}
              {changes ? "Update the plan" : "Approve plan"}
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
            label="Your plan"
            number={index + 1}
            onAnswer={(answer, note) => onAnswer(question.id, answer, note)}
          />
        ))}
      </ol>
    </section>
  );
}
