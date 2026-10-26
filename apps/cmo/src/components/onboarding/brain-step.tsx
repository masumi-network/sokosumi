"use client";

import type { CmoOverview } from "@sokosumi/core-client";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import type { BrandBrain } from "../../lib/brand-sections";
import type { CusoMessage } from "../../lib/chat-messages";
import { BrandReveal } from "../brand-profile";
import { businessDisplayName } from "../business-mark";
import { Refusal } from "./refusal";
import { StepHead } from "./step-head";

interface BrainStepProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  onCorrect: (text: string) => Promise<void>;
  onSave: (brain: BrandBrain) => Promise<void>;
  onPlan: () => Promise<string | null>;
  /** Set when the founder opened this step again: leads on to where they were. */
  ahead?: { label: string; onClick: () => void };
}

/** What Cuso learned, as the founder's brand: logo, colours, voice, market. */
export function BrainStep({
  overview,
  messages,
  onCorrect,
  onSave,
  onPlan,
  ahead,
}: BrainStepProps) {
  const [sent, setSent] = useState<{
    text: string;
    /** Cuso's last message when it was sent; a new one is his answer. */
    after: string | null;
  } | null>(null);
  const [planning, startPlanning] = useTransition();
  const [refusal, setRefusal] = useState<string | null>(null);
  const lastWord = [...messages].reverse().find((message) => message.fromCuso);
  // A correction is applied once Cuso answers after it; until then the
  // founder sees what they asked for and that he is on it.
  const answered =
    sent !== null && lastWord !== undefined && lastWord.id !== sent.after;
  // A turn that ended without a reply, or never answered, must not lock the
  // founder in: after a grace period the change counts as not done.
  const [stale, setStale] = useState(false);
  const idle = overview.botStatus !== "RUNNING";
  useEffect(() => {
    setStale(false);
    if (sent === null || answered) return;
    const timer = window.setTimeout(
      () => setStale(true),
      idle ? 30_000 : 240_000,
    );
    return () => window.clearTimeout(timer);
  }, [sent, answered, idle]);
  const fixing = sent !== null && !answered && !stale;
  // Right after research Cuso is still wrapping up his turn for a few seconds.
  const finishing = !fixing && !stale && overview.botStatus === "RUNNING";
  const name = businessDisplayName(overview);

  return (
    <section className="ob-brain">
      <StepHead
        step={2}
        title="Brand Brain"
        mood="wave"
        busy={fixing || finishing}
        say={
          ahead
            ? "Your Brand Brain. What you change here goes into everything I write."
            : `This is ${name} as I see it. Fix anything that's off, then approve it and I plan your month.`
        }
        note={
          fixing
            ? "Updating your Brand Brain. About half a minute."
            : stale && !answered
              ? "That change didn't come through. Ask again, or approve this version."
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
              className="ob-button ob-button-lg"
              disabled={planning || fixing || finishing}
              onClick={() =>
                startPlanning(async () => {
                  setRefusal(await onPlan());
                })
              }
            >
              {planning ? (
                "Starting…"
              ) : fixing || finishing ? (
                <>
                  <Loader2 size={16} className="ob-spin" aria-hidden="true" />
                  {fixing ? "Cuso is updating" : "Cuso is finishing up"}
                </>
              ) : (
                <>
                  <Check size={16} aria-hidden="true" />
                  Approve Brand Brain
                </>
              )}
            </button>
          )
        }
      />
      {refusal ? (
        <Refusal text={refusal} topUpUrl={overview.subscribeUrl} />
      ) : null}
      <BrandReveal
        overview={overview}
        intro={!ahead}
        explain={false}
        onSave={onSave}
        onAsk={async (text) => {
          setSent({ text, after: lastWord?.id ?? null });
          try {
            await onCorrect(text);
          } catch (error) {
            setSent(null);
            throw error;
          }
        }}
      />
      {sent && answered && lastWord ? (
        <p className="ob-note ob-cuso-said" aria-live="polite">
          Cuso: {lastWord.content}
        </p>
      ) : null}
    </section>
  );
}
