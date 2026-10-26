"use client";

import "./onboarding.css";

import type { CmoOverview, SubscriptionCatalog } from "@sokosumi/core-client";
import { Check, ChevronDown, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import { BusinessMark } from "../business-mark";
import { Logo } from "../logo";
import { BrainStep } from "./brain-step";
import { ConnectStep, needsAccounts } from "./connect-step";
import { PricingStep } from "./pricing-step";
import { ResearchStep } from "./research-step";
import { ResultsStep } from "./results-step";
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
  saveBrandBrain: (
    brandBrain: NonNullable<CmoOverview["brandBrain"]>,
  ) => Promise<CmoOverview>;
  chooseMockPlan: (
    plan: string,
  ) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  /** Records that the founder connected or skipped the Accounts step. */
  finishAccounts: () => Promise<CmoOverview>;
  /** Adds the founder's mailing list for the newsletter. */
  addMailingList: (
    text: string,
  ) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  connectChannel: (
    provider: "x" | "linkedin" | "instagram" | "facebook",
  ) => Promise<{ url: string | null; error: string | null }>;
  completeOnboarding: () => Promise<void>;
  signOut: () => Promise<void>;
}

export type OnboardingStep =
  | "research"
  | "brain"
  | "planning"
  | "strategy"
  | "results"
  | "connect"
  | "pricing";

const STEPS: { id: OnboardingStep; label: string }[] = [
  { id: "research", label: "Research" },
  { id: "brain", label: "Brand Brain" },
  { id: "strategy", label: "Strategy" },
  { id: "results", label: "Results" },
  { id: "connect", label: "Accounts" },
  { id: "pricing", label: "Pricing" },
];

/** Where the founder is, from what Cuso has done so far. */
export function onboardingStep(overview: CmoOverview): OnboardingStep {
  const work = overview.work;
  if (!overview.brandBrain) return "research";
  // Once a plan exists it stays on screen while Cuso writes or changes it.
  if (!overview.strategy) {
    return work?.kind === "strategy" && work.status !== "done"
      ? "planning"
      : "brain";
  }
  if (!overview.strategyApprovedAt) return "strategy";
  // Saved in Core, so a reload after the Accounts step resumes on the plan.
  return overview.accountsDoneAt || !needsAccounts(overview)
    ? "pricing"
    : "connect";
}

/** Steps the founder can open again once past them; research only leads to the Brand Brain. */
function canRevisit(step: OnboardingStep, overview: CmoOverview): boolean {
  if (step === "brain" || step === "strategy") return true;
  if (step === "results") return overview.strategyApprovedAt !== null;
  return step === "connect" && needsAccounts(overview);
}

function stepIndex(step: OnboardingStep): number {
  return STEPS.findIndex(
    (candidate) => candidate.id === (step === "planning" ? "strategy" : step),
  );
}

const POLL_MS = 2_500;

/** Who is signed in, with the way out; closes on a click outside or Escape. */
function AccountMenu({
  overview,
  name,
  signOut,
}: {
  overview: CmoOverview;
  name: string;
  signOut: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof MouseEvent &&
        root.current?.contains(event.target as Node)
      ) {
        return;
      }
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="ob-who" ref={root}>
      <button
        type="button"
        className="ob-who-button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((value) => !value)}
      >
        <BusinessMark overview={overview} />
        <span className="ob-who-name">{name}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <form className="ob-who-menu" role="menu" action={signOut}>
          <button type="submit" role="menuitem" className="ob-who-item">
            <LogOut size={14} aria-hidden="true" />
            Sign out
          </button>
        </form>
      ) : null}
    </div>
  );
}

interface OnboardingFlowProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  plans: SubscriptionCatalog | null;
  name: string;
  /** "connect" when a network's connection sends the founder back. */
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
  // A finished step opened again from the rail, or Accounts after a connection.
  const [viewing, setViewing] = useState<OnboardingStep | null>(
    initialStep === "connect" ? "connect" : null,
  );

  // The connection redirect's query has been read; a reload routes from Core.
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, "", "/");
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
  const reached = stepIndex(derived);
  const revisiting =
    viewing !== null &&
    canRevisit(viewing, overview) &&
    stepIndex(viewing) < reached;
  const step: OnboardingStep = revisiting && viewing ? viewing : derived;
  const current = stepIndex(step);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  // Each step's head sticks right under the top bar, whatever its height.
  const root = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = top.current;
    if (!bar) return;
    const measure = () =>
      root.current?.style.setProperty("--ob-top-h", `${bar.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // A finished step opened again leads forward to where the founder was.
  const ahead = revisiting
    ? {
        label: STEPS[reached]?.label ?? "",
        onClick: () => setViewing(null),
      }
    : undefined;

  return (
    <div className="ob" ref={root}>
      <header className="ob-top" ref={top}>
        <Logo />
        <ol className="ob-steps" aria-label="Onboarding">
          {STEPS.map((candidate, index) => {
            const content = (
              <>
                <span className="ob-dot" aria-hidden="true">
                  {index < reached && index !== current ? (
                    <Check size={11} strokeWidth={3} />
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="ob-step-label">{candidate.label}</span>
              </>
            );
            const open =
              index === current
                ? null
                : index === reached
                  ? () => setViewing(null)
                  : index < reached && canRevisit(candidate.id, overview)
                    ? () => setViewing(candidate.id)
                    : null;
            return (
              <li
                key={candidate.id}
                className={
                  index === current
                    ? "now"
                    : index < reached
                      ? "done"
                      : undefined
                }
                aria-current={index === current ? "step" : undefined}
              >
                {open ? (
                  <button type="button" className="ob-step" onClick={open}>
                    {content}
                  </button>
                ) : (
                  <span className="ob-step">{content}</span>
                )}
              </li>
            );
          })}
        </ol>
        <AccountMenu
          overview={overview}
          name={name}
          signOut={actions.signOut}
        />
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
            onSave={async (brandBrain) => {
              setOverview(await actions.saveBrandBrain(brandBrain));
            }}
            ahead={ahead}
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
            ahead={ahead}
            onApprove={async () => {
              setOverview(await actions.approveStrategy());
              // Approving opens Results: how the plan is measured and adjusted.
              setViewing("results");
            }}
          />
        ) : step === "results" ? (
          <ResultsStep
            overview={overview}
            next={STEPS[reached]?.label.toLowerCase() ?? "accounts"}
            onContinue={() => setViewing(null)}
          />
        ) : step === "connect" ? (
          <ConnectStep
            overview={overview}
            onConnect={actions.connectChannel}
            onMailingList={async (text) => {
              const result = await actions.addMailingList(text);
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
            onContinue={async () => {
              setOverview(await actions.finishAccounts());
              setViewing(null);
            }}
          />
        ) : (
          <PricingStep
            overview={overview}
            plans={plans}
            onStart={actions.completeOnboarding}
            onRefresh={refresh}
            onChooseMockPlan={async (plan) => {
              const result = await actions.chooseMockPlan(plan);
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
          />
        )}
      </main>
    </div>
  );
}
