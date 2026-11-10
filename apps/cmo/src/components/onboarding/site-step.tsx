"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight } from "lucide-react";
import { useState } from "react";
import { AGENT_NAME } from "../../lib/agent";
import {
  BRAND_SECTIONS,
  brandProfile,
  sourceHost,
} from "../../lib/brand-sections";
import type { CusoMessage } from "../../lib/chat-messages";
import { hostOf } from "../brand-profile";
import { CusoAvatar } from "../cuso";
import { CusoClip } from "../cuso-clip";
import { SubmitButton } from "../submit-button";
import { TypeIn } from "../type-in";
import { brandTiles, SiteCard, tileSource } from "./brand-step";
import { Checklist, RESEARCH_PHASES, workChecklist } from "./checklist";
import { setupRows, siteQuestion } from "./live";
import {
  type Answer,
  QuestionCard,
  RetryButton,
  useAnswers,
} from "./questions";
import { Refusal } from "./refusal";
import type { SitePhase } from "./step";

/** Found items (or skeletons for sections to come) shown at most. */
const MAX_FOUND = 3;

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

interface FoundItem {
  id: string;
  label: string;
  value: string;
  source?: string;
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
  const asked = siteQuestion(overview, messages, phase);
  const failed = phase === "failed" && !asked;
  const running = phase === "reading" && !finished;
  const noCredits = failed && overview.billing.availableCredits <= 0;

  const [questions, answer] = useAnswers(brain?.questions ?? [], onAnswer);
  const answered = questions.map((question) => question.answer !== undefined);
  const firstOpen = answered.indexOf(false);
  // Where the founder is in the questions; "Change answers" starts again.
  const [at, setAt] = useState<number | null>(null);
  // Skipping shows its result at once; the cookie write takes a moment.
  const [skipping, setSkipping] = useState(false);
  const asking = !skipping && (at !== null || (firstOpen !== -1 && !skipped));
  const index = at ?? Math.max(firstOpen, 0);
  const question = questions[index];

  const found = work
    ? {
        saved: work.sectionsSaved,
        total: work.sectionsTotal,
        sections: work.sections,
      }
    : null;
  // Every section is saved and Cuso is writing the summary and his questions
  // from them: the slowest quiet stretch of the read. Holds the section count.
  const composing =
    running && !brain && found && found.saved >= found.total
      ? found.total
      : null;
  // The Brand Brain's first tiles once it exists, else the latest sections
  // Cuso saved; every slot keeps its place before it fills.
  const items: FoundItem[] = brain
    ? brandTiles(brain, async () => {})
        .slice(0, MAX_FOUND)
        .map((tile) => ({
          id: tile.id,
          label: tile.label,
          value: tile.value,
          source: sourceHost(
            tileSource(tile, brandProfile(brain), overview.websiteUrl),
          ),
        }))
    : (found?.sections ?? []).slice(-MAX_FOUND).map((section) => ({
        id: section.key,
        label: BRAND_SECTIONS[section.key].title,
        value: section.headline,
      }));
  const rivals =
    (brain?.competitors.length ?? 0) + (brain?.alternatives?.length ?? 0);
  const checklist = workChecklist(
    work?.steps ?? [],
    RESEARCH_PHASES,
    running,
  ).map((item, at) => ({
    ...item,
    // The count, once the data gives one.
    label:
      at === 1 && rivals > 0
        ? `Comparing ${rivals} ${rivals === 1 ? "competitor" : "competitors"}`
        : item.label,
    state: brain && !running ? ("done" as const) : item.state,
  }));

  return (
    <section className="panel ob-site">
      <div className="ob-site-left">
        <div className="card ob-reading">
          <CusoClip
            src="/cuso/reading-scene.jpg"
            alt={`${AGENT_NAME} reading a site with a magnifier`}
            width={168}
            height={168}
          />
          <p className="muted">
            {running
              ? `${AGENT_NAME} is reading`
              : `${AGENT_NAME} read your site`}
          </p>
          <Checklist items={checklist} />
        </div>
        <SiteCard
          overview={overview}
          host={site}
          pending={phase === "reading"}
        />
        <div className="card ob-found">
          <div className="ob-found-head">
            <h2>What I found so far</h2>
            {composing !== null ? (
              <span className="ob-small">All {composing} sections are in.</span>
            ) : found ? (
              <span className="ob-small num">
                {found.saved} of {found.total} sections
              </span>
            ) : null}
          </div>
          <ul className="ob-found-list">
            {Array.from({ length: MAX_FOUND }, (_, slot) => {
              const item = items[slot];
              // A slot is its place in the list: it stays mounted as it fills.
              return item ? (
                <li key={slot} className="ob-slot">
                  <span className="ob-small muted">{item.label}</span>
                  <b>
                    <TypeIn text={item.value} />
                  </b>
                  {item.source ? (
                    <span className="ob-tile-source">
                      Source: {item.source}
                    </span>
                  ) : null}
                </li>
              ) : (
                <li
                  key={slot}
                  className="ob-slot ob-skeleton"
                  aria-hidden="true"
                >
                  <span />
                  <span />
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      <div className="ob-site-right">
        {failed ? (
          <div className="card card-focus ob-says">
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
            onSkip={() => {
              setSkipping(true);
              onSkip()
                .catch(() => {})
                .finally(() => {
                  setSkipping(false);
                  setAt(null);
                });
            }}
          />
        ) : finished || (skipping && phase !== "reading") ? (
          <div className="card card-focus ob-says">
            <CusoAvatar pose="done" size={96} />
            <p className="ob-value">That's all I need.</p>
            <button
              type="button"
              className="button"
              disabled={skipping}
              onClick={onContinue}
            >
              {skipping
                ? "Skipping…"
                : next === "plan"
                  ? "Write my plan"
                  : "See your brand"}
              {skipping ? null : <ArrowRight size={16} aria-hidden="true" />}
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
          <>
            {questions.length === 0 ? (
              // Once, until the first question: what hiring set up.
              <div className="card ob-setup">
                <h2>Set up for {site}</h2>
                <Checklist
                  items={setupRows(overview).map((label) => ({
                    label,
                    state: "done" as const,
                  }))}
                />
              </div>
            ) : null}
            <div className="card ob-says" aria-live="polite">
              <CusoAvatar pose="reading" size={96} />
              <p className="ob-value">
                {questions.length > 0
                  ? "Thanks. I'm finishing the read."
                  : composing !== null
                    ? `Now I'm putting your ${composing} sections together: your promise, your voice and the questions I still have.`
                    : "My questions come when the read lands."}
              </p>
            </div>
          </>
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
      className="card card-focus ob-says"
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
