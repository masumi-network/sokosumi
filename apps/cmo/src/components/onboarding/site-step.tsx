"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";

import { BRAND_SECTIONS } from "../../lib/brand-sections";
import type { CusoMessage } from "../../lib/chat-messages";
import { hostOf } from "../brand-profile";
import { AGENT_NAME, CusoAvatar } from "../cuso";
import { SubmitButton } from "../submit-button";
import {
  type Answer,
  Checklist,
  QuestionCard,
  RESEARCH_PHASES,
  RetryButton,
  SkeletonTile,
  useAnswers,
  workChecklist,
} from "./parts";
import { Refusal } from "./refusal";
import type { SitePhase } from "./step";

/** Skeleton tiles shown for sections Cuso has not saved yet, at most. */
const MAX_SKELETONS = 6;

interface SiteStepProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  /** Where the read stands, from `onboardingStep`. */
  phase: SitePhase;
  /** Where "next" leads once Site is done. */
  next: "brand" | "plan";
  /** Everything is asked and answered, or skipped, and the read is done. */
  finished: boolean;
  /** The founder left the questions for later. */
  skipped: boolean;
  onAnswer: (
    questionId: string,
    answer: Answer,
    note?: string,
  ) => Promise<void>;
  onSkip: () => Promise<void>;
  /** "See your brand" or "Write my plan": on to the next step. */
  onContinue: () => void;
  onRetry: () => Promise<string | null>;
  onReply: (text: string) => Promise<void>;
}

/**
 * Cuso reading the founder's site, live. While he reads, his yes/no questions
 * arrive on the right, one at a time; once they are done, so is the step.
 */
export function SiteStep({
  overview,
  messages,
  phase,
  next,
  finished,
  skipped,
  onAnswer,
  onSkip,
  onContinue,
  onRetry,
  onReply,
}: SiteStepProps) {
  const brain = overview.brandBrain;
  const work = overview.work?.kind === "research" ? overview.work : null;
  const site = hostOf(overview.websiteUrl);
  // Cuso may stop to ask the founder something before he saves a Brand Brain.
  const stopped =
    phase === "failed" &&
    overview.learning !== "failed" &&
    work?.status !== "failed";
  const asked = stopped
    ? [...messages].reverse().find((message) => message.fromCuso)
    : undefined;
  const failed = phase === "failed" && !asked;
  const running = phase === "reading" && !finished;
  const noCredits = failed && overview.billing.availableCredits <= 0;

  const [questions, answer] = useAnswers(brain?.questions ?? [], onAnswer);
  const answered = questions.map((question) => question.answer !== undefined);
  const firstOpen = answered.indexOf(false);
  // Where the founder is in the questions; "Change answers" starts again.
  const [at, setAt] = useState<number | null>(null);
  const asking = at !== null || (firstOpen !== -1 && !skipped);
  const index = at ?? Math.max(firstOpen, 0);
  const question = questions[index];

  const title = failed
    ? "The read stopped."
    : asked
      ? "I have a question."
      : running
        ? questions.length > 0
          ? `Reading ${site}. Answer a few while you wait.`
          : `Reading ${site}.`
        : finished
          ? `I read ${site}.`
          : `I read ${site}. Answer a few before I show you.`;

  const found = work
    ? { saved: work.sectionsSaved, total: work.sectionsTotal }
    : null;
  const checklist = workChecklist(
    work?.steps ?? [],
    RESEARCH_PHASES,
    running,
  ).map((item) =>
    brain && !running ? { ...item, state: "done" as const } : item,
  );

  return (
    <section className="ob-panel panel ob-site">
      <div className="ob-site-left">
        <div className="card ob-reading">
          <img
            src="/cuso/reading-scene.jpg"
            alt={`${AGENT_NAME} reading a site with a magnifier`}
            width={168}
            height={168}
          />
          <p className="ob-muted">
            {running
              ? `${AGENT_NAME} is reading`
              : `${AGENT_NAME} read your site`}
          </p>
          <h1 className="ob-h1">{title}</h1>
          <Checklist items={checklist} />
        </div>
        {found ? (
          <div className="card ob-found">
            <div className="ob-found-head">
              <h2>What I found so far</h2>
              <span className="ob-small num">
                {found.saved} of {found.total} sections
              </span>
            </div>
            <div className="ob-skeletons">
              {Array.from(
                {
                  length: Math.min(
                    Math.max(found.total - found.saved, 0),
                    MAX_SKELETONS,
                  ),
                },
                (_, skeleton) => (
                  // Placeholders have no identity beyond their place.
                  <SkeletonTile key={skeleton} />
                ),
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="ob-site-right">
        {failed ? (
          <div className="card ob-focus ob-says">
            <CusoAvatar pose="needs-you" size={96} />
            {noCredits ? (
              <Refusal text="credits" topUpUrl={overview.subscribeUrl} />
            ) : (
              <p className="ob-value">
                {found && found.saved > 0
                  ? "Nothing was lost. Try again and I finish your Brand Brain."
                  : "Nothing was lost. Try again and I start over."}
              </p>
            )}
            <RetryButton onRetry={onRetry} topUpUrl={overview.subscribeUrl} />
          </div>
        ) : asked ? (
          <QuestionReply question={asked} onReply={onReply} />
        ) : asking && question ? (
          <QuestionCard
            // A new question starts with a clean card.
            key={question.id}
            topic={BRAND_SECTIONS[question.section].title}
            question={question}
            index={index}
            answered={answered}
            onAnswer={async (value, note) => {
              await answer(question.id, value, note);
              setAt(index + 1 < questions.length ? index + 1 : null);
            }}
            onSkip={() => void onSkip().then(() => setAt(null))}
          />
        ) : finished ? (
          <div className="card ob-focus ob-says">
            <CusoAvatar pose="done" size={96} />
            <p className="ob-value">That's all I need.</p>
            <button type="button" className="button" onClick={onContinue}>
              {next === "plan" ? "Write my plan" : "See your brand"}
              <ArrowRight size={16} aria-hidden="true" />
            </button>
            {questions.length > 0 ? (
              <button
                type="button"
                className="button button-ghost button-small"
                onClick={() => setAt(0)}
              >
                Change answers
              </button>
            ) : null}
          </div>
        ) : (
          <div className="card ob-focus ob-says" aria-live="polite">
            <CusoAvatar pose="thinking" size={96} />
            <p className="ob-value">
              {questions.length === 0
                ? "My questions come when the read lands."
                : "Thanks. I'm finishing the read."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

interface QuestionReplyProps {
  question: CusoMessage;
  onReply: (text: string) => Promise<void>;
}

/** Cuso stopped to ask the founder something in words. */
function QuestionReply({ question, onReply }: QuestionReplyProps) {
  const [text, setText] = useState("");
  return (
    <form
      className="card ob-focus ob-says"
      action={async () => {
        const reply = text.trim();
        if (!reply) return;
        await onReply(reply);
        setText("");
      }}
    >
      <CusoAvatar pose="needs-you" size={96} />
      <p className="ob-value">{question.content}</p>
      <textarea
        className="ob-textarea"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your answer"
        aria-label="Your answer"
      />
      <SubmitButton className="button">Send</SubmitButton>
    </form>
  );
}
