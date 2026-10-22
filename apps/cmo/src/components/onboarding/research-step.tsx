"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import {
  BookOpen,
  Check,
  CircleAlert,
  Globe,
  Loader2,
  Search,
  Sparkles,
  Swords,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, useTransition } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import { CusoCursor } from "./cuso-cursor";

type Work = NonNullable<CmoOverview["work"]>;
type Step = Work["steps"][number];

const STEP_ICONS = {
  search: Search,
  read: BookOpen,
  study: Swords,
  brain: Sparkles,
  strategy: Sparkles,
  other: Globe,
} as const;

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Seconds since the work started, ticking while it runs. */
function useElapsed(since: Date | string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running]);
  if (!since) return 0;
  return Math.max(0, Math.round((now - new Date(since).getTime()) / 1_000));
}

const RESEARCH_PHASES = [
  { kinds: ["read"], label: "Your website" },
  { kinds: ["search", "study"], label: "Your market and competitors" },
  { kinds: ["brain"], label: "Your Brand Brain" },
] as const;

const PLANNING_PHASES = [
  { kinds: ["other"], label: "Your channels" },
  { kinds: ["strategy"], label: "Four weeks, day by day" },
] as const;

function phaseState(
  steps: Step[],
  kinds: readonly string[],
  running: boolean,
  isLast: boolean,
): "done" | "now" | "next" {
  const mine = steps.filter((step) => kinds.includes(step.kind));
  if (mine.some((step) => step.status === "running")) return "now";
  if (mine.length > 0) return isLast && running ? "now" : "done";
  return "next";
}

interface ResearchStepProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onRetry: () => Promise<string | null>;
  onReply: (text: string) => Promise<void>;
}

/**
 * Cuso at work, live: what he is reading and searching right now, as it
 * happens. Used for the first research and for planning the strategy.
 */
export function ResearchStep({
  overview,
  messages,
  onRetry,
  onReply,
}: ResearchStepProps) {
  const work = overview.work;
  const planning = work?.kind === "strategy";
  const status = work?.status ?? overview.learning;
  const running = status === "running";
  const elapsed = useElapsed(work?.startedAt, running);
  const steps = work?.steps ?? [];
  const site = host(overview.websiteUrl);
  const phases = planning ? PLANNING_PHASES : RESEARCH_PHASES;
  const noCredits =
    status === "failed" && overview.billing.availableCredits <= 0;
  const asked =
    !planning && status === "done" && !overview.brandBrain
      ? [...messages].reverse().find((message) => message.fromCuso)
      : undefined;

  return (
    <section className="ob-research">
      <div className="ob-stage">
        <CusoCursor active={running} />
        <h1 className="ob-title">
          {status === "failed"
            ? planning
              ? "Planning stopped"
              : "Research stopped"
            : asked
              ? "Cuso has a few questions"
              : planning
                ? "Cuso is planning your month"
                : `Cuso is studying ${site}`}
        </h1>
        <p className="ob-lede">
          {noCredits
            ? "You're out of credits. Top up on Sokosumi, then try again."
            : status === "failed"
              ? "Nothing was lost. Try again and Cuso starts over."
              : asked
                ? "Answer below and he finishes your Brand Brain."
                : planning
                  ? "Every day of the next four weeks: what goes out, where, when, and why."
                  : "Your site, your market and your competitors. This takes about a minute and a half."}
        </p>
        {running ? (
          <p className="ob-elapsed" aria-live="polite">
            <Loader2 size={14} className="ob-spin" aria-hidden="true" />
            {elapsed < 60
              ? `${elapsed}s`
              : `${Math.floor(elapsed / 60)}m ${String(elapsed % 60).padStart(2, "0")}s`}
          </p>
        ) : null}
        <ol className="ob-phases">
          {phases.map((phase, index) => {
            const state = phaseState(
              steps,
              phase.kinds,
              running,
              index === phases.length - 1,
            );
            return (
              <li key={phase.label} className={`ob-phase ${state}`}>
                <span className="ob-phase-dot" aria-hidden="true">
                  {state === "done" ? (
                    <Check size={12} strokeWidth={3} />
                  ) : state === "now" ? (
                    <Loader2 size={12} className="ob-spin" />
                  ) : null}
                </span>
                {phase.label}
              </li>
            );
          })}
        </ol>
        {status === "failed" ? <RetryButton onRetry={onRetry} /> : null}
        {asked ? <QuestionReply question={asked} onReply={onReply} /> : null}
      </div>

      <div className="ob-feed" aria-label="What Cuso is doing">
        <p className="ob-feed-title">
          <span className={running ? "ob-live on" : "ob-live"} />
          {running ? "Live" : "What Cuso did"}
        </p>
        {steps.length === 0 ? (
          <p className="ob-feed-empty">
            {running ? "Getting started…" : "Nothing yet."}
          </p>
        ) : (
          <ul className="ob-feed-list">
            <AnimatePresence initial={false}>
              {[...steps].reverse().map((step) => {
                const Icon = STEP_ICONS[step.kind];
                return (
                  <motion.li
                    key={step.id}
                    layout
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: 0.25,
                      ease: [0.25, 1, 0.5, 1] as const,
                    }}
                    className={`ob-feed-item ${step.status}`}
                  >
                    <span className="ob-feed-icon" aria-hidden="true">
                      {step.url ? (
                        <span className="ob-favicon">
                          {host(step.url).charAt(0).toUpperCase()}
                        </span>
                      ) : (
                        <Icon size={14} />
                      )}
                    </span>
                    <span className="ob-feed-label">{step.label}</span>
                    <span className="ob-feed-state" aria-hidden="true">
                      {step.status === "running" ? (
                        <Loader2 size={14} className="ob-spin" />
                      ) : step.status === "failed" ? (
                        <CircleAlert size={14} />
                      ) : (
                        <Check size={14} />
                      )}
                    </span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
}

function RetryButton({ onRetry }: { onRetry: () => Promise<string | null> }) {
  const [pending, startTransition] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  return (
    <div className="ob-actions">
      <button
        type="button"
        className="ob-button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setRefusal(await onRetry());
          })
        }
      >
        {pending ? "Starting…" : "Try again"}
      </button>
      {refusal ? (
        <p className="ob-note" role="alert">
          {/credits/i.test(refusal)
            ? "You're out of credits. Top up on Sokosumi, then try again."
            : refusal}
        </p>
      ) : null}
    </div>
  );
}

function QuestionReply({
  question,
  onReply,
}: {
  question: CusoMessage;
  onReply: (text: string) => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="ob-ask"
      onSubmit={(event) => {
        event.preventDefault();
        const reply = text.trim();
        if (!reply) return;
        startTransition(async () => {
          await onReply(reply);
          setText("");
        });
      }}
    >
      <p className="ob-ask-question">{question.content}</p>
      <textarea
        className="ob-input"
        rows={3}
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Your answer"
        aria-label="Your answer"
      />
      <button type="submit" className="ob-button" disabled={pending}>
        {pending ? "Sending…" : "Send"}
      </button>
    </form>
  );
}
