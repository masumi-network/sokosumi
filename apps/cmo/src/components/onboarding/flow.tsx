"use client";

import "./onboarding.css";

import type { CmoOverview, SubscriptionCatalog } from "@sokosumi/core-client";
import { Check } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import { Logo } from "../logo";
import { BrainStep } from "./brain-step";
import { ConnectStep, strategySocialChannels } from "./connect-step";
import { PricingStep } from "./pricing-step";
import { ResearchStep } from "./research-step";
import { StrategyStep } from "./strategy-step";

export interface OnboardingActions {
  loadState: () => Promise<{
    overview: CmoOverview | null;
    messages: CusoMessage[];
  }>;
  sendMessage: (content: string) => Promise<void>;
  retryLearning: () => Promise<{
    overview: CmoOverview;
    error: string | null;
  }>;
  requestStrategy: (note?: string) => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
  approveStrategy: () => Promise<CmoOverview>;
  connectChannel: (
    provider:
      | "x"
      | "linkedin"
      | "instagram"
      | "facebook"
      | "tiktok"
      | "youtube",
  ) => Promise<{ url: string | null; error: string | null }>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
}

export type OnboardingStep =
  | "research"
  | "brain"
  | "planning"
  | "strategy"
  | "connect"
  | "pricing";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "research", label: "Research" },
  { id: "brain", label: "Brand Brain" },
  { id: "strategy", label: "Strategy" },
  { id: "connect", label: "Accounts" },
  { id: "pricing", label: "Plan" },
];

/** Where the founder is, from what Cuso has done so far. */
export function onboardingStep(overview: CmoOverview): OnboardingStep {
  const work = overview.work;
  if (!overview.brandBrain) return "research";
  if (work?.kind === "strategy" && work.status === "running") return "planning";
  if (!overview.strategy) {
    return work?.kind === "strategy" && work.status === "failed"
      ? "planning"
      : "brain";
  }
  if (!overview.strategyApprovedAt) return "strategy";
  return "connect";
}

function stepIndex(step: OnboardingStep): number {
  return STEPS.findIndex(
    (candidate) => candidate.id === (step === "planning" ? "strategy" : step),
  );
}

const POLL_MS = 2_500;

interface OnboardingFlowProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  plans: SubscriptionCatalog | null;
  name: string;
  /** "connect" or "pricing": where a redirect (OAuth, checkout) returns to. */
  initialStep?: string;
  actions: OnboardingActions;
}

/**
 * CMO's first run: full-screen steps from Cuso's research to the plan. The
 * chat becomes home once the founder starts.
 */
export function OnboardingFlow({
  overview: initialOverview,
  messages: initialMessages,
  plans,
  name,
  initialStep,
  actions,
}: OnboardingFlowProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [afterApproval, setAfterApprovalState] = useState<
    "connect" | "pricing"
  >(initialStep === "pricing" ? "pricing" : "connect");
  // In the URL, so a reload or a return from checkout lands on the same step.
  const setAfterApproval = useCallback((next: "connect" | "pricing") => {
    setAfterApprovalState(next);
    window.history.replaceState(null, "", `/?step=${next}`);
  }, []);

  const refresh = useCallback(async () => {
    const state = await actions.loadState().catch(() => null);
    if (!state?.overview) return;
    setOverview(state.overview);
    setMessages(state.messages);
  }, [actions]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  const derived = onboardingStep(overview);
  const step: OnboardingStep =
    derived === "connect"
      ? afterApproval === "pricing" ||
        strategySocialChannels(overview).length === 0
        ? "pricing"
        : "connect"
      : derived;
  const current = stepIndex(step);

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <ol className="ob-steps" aria-label="Onboarding">
          {STEPS.map((candidate, index) => (
            <li
              key={candidate.id}
              className={
                index < current ? "done" : index === current ? "now" : undefined
              }
              aria-current={index === current ? "step" : undefined}
            >
              <span className="ob-dot" aria-hidden="true">
                {index < current ? (
                  <Check size={11} strokeWidth={3} />
                ) : (
                  index + 1
                )}
              </span>
              <span className="ob-step-label">{candidate.label}</span>
            </li>
          ))}
        </ol>
        <div className="ob-who">
          <BusinessMark overview={overview} />
          <span className="ob-who-name">{name}</span>
        </div>
      </header>

      <main className="ob-main" key={step}>
        {step === "research" ? (
          <ResearchStep
            overview={overview}
            messages={messages}
            onRetry={async () => {
              const result = await actions.retryLearning();
              setOverview(result.overview);
              return result.error;
            }}
            onReply={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
          />
        ) : step === "brain" ? (
          <BrainStep
            overview={overview}
            messages={messages}
            onCorrect={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
            onPlan={async () => {
              const result = await actions.requestStrategy();
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
          />
        ) : step === "planning" ? (
          <ResearchStep
            overview={overview}
            messages={messages}
            onRetry={async () => {
              const result = await actions.requestStrategy();
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
            onReply={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
          />
        ) : step === "strategy" ? (
          <StrategyStep
            overview={overview}
            onChange={async (note) => {
              const result = await actions.requestStrategy(note);
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
            onApprove={async () => {
              setOverview(await actions.approveStrategy());
            }}
          />
        ) : step === "connect" ? (
          <ConnectStep
            overview={overview}
            onConnect={actions.connectChannel}
            onContinue={() => setAfterApproval("pricing")}
          />
        ) : (
          <PricingStep
            overview={overview}
            plans={plans}
            onBack={
              strategySocialChannels(overview).length > 0
                ? () => setAfterApproval("connect")
                : undefined
            }
            onStart={actions.completeOnboarding}
            onRefresh={refresh}
          />
        )}
      </main>
    </div>
  );
}

/** The business as it names itself ("Cal.com"), else its domain. */
export function businessDisplayName(overview: CmoOverview): string {
  const siteName = overview.brandVisual?.siteName;
  return siteName && siteName.length <= 40 ? siteName : overview.businessName;
}

/** The business's own mark: its logo when Cuso found one, else its initial. */
export function BusinessMark({
  overview,
  size = 28,
}: {
  overview: CmoOverview;
  size?: number;
}) {
  const logo = overview.brandVisual?.logoUrl ?? overview.projectLogo;
  const accent = overview.brandVisual?.colors[0];
  if (logo) {
    return (
      <img
        className="ob-mark"
        src={logo}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      className="ob-mark ob-mark-letter"
      style={{
        width: size,
        height: size,
        ...(accent ? { background: accent, color: "#fff" } : {}),
      }}
      aria-hidden="true"
    >
      {overview.businessName.charAt(0).toUpperCase()}
    </span>
  );
}
