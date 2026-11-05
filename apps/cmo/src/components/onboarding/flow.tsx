"use client";

import "./onboarding.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { ChevronDown, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import type { SkippedStep } from "../../lib/skipped-steps";
import type { AdActions } from "../ads";
import { hostOf } from "../brand-profile";
import { Logo } from "../logo";
import { StartOver } from "../start-over";
import { ThemeToggle } from "../theme-toggle";
import { BrandStep } from "./brand-step";
import { LaunchStep } from "./launch-step";
import { StepMarkers } from "./parts";
import { PlanStep } from "./plan-step";
import { SiteStep } from "./site-step";
import { type OnboardingStep, onboardingStep, STEPS, stepIndex } from "./step";

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
  /** The owner's own monthly ad budget; Cuso re-plans around it. */
  setAdBudget: (
    monthly: number,
    currency: string,
  ) => Promise<{ overview: CmoOverview | null; error: string | null }>;
  /** The founder approved the Brand Brain; the plan comes next. */
  approveBrandBrain: () => Promise<CmoOverview>;
  answerBrandQuestion: (answer: {
    questionId: string;
    answer: "yes" | "no" | "unsure";
    note?: string;
  }) => Promise<CmoOverview>;
  /** The founder left Cuso's questions about the brand for later. */
  skipBrandQuestions: () => Promise<CmoOverview>;
  saveBrandBrain: (
    brandBrain: NonNullable<CmoOverview["brandBrain"]>,
  ) => Promise<CmoOverview>;
  answerPlanQuestion: (answer: {
    questionId: string;
    answer: "yes" | "no" | "unsure";
    note?: string;
  }) => Promise<CmoOverview>;
  applyPlanAnswers: () => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
  /** Records that the founder connected or skipped the Accounts step. */
  finishAccounts: () => Promise<never>;
  connectChannel: (
    provider: "x" | "linkedin" | "instagram" | "facebook" | "youtube",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectMeasurement: (
    provider: CmoOverview["measurement"][number]["provider"],
    from: "onboarding" | "app",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectAds: AdActions["connectAds"];
  /** Archives this Cuso and opens the hiring form; a refusal comes back as text. */
  startOver: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** The steps the founder can open again once past them; Site only leads to Brand. */
function canRevisit(step: OnboardingStep, overview: CmoOverview): boolean {
  if (step === "brand") return overview.brandBrain !== null;
  return step === "plan" && overview.strategy !== null;
}

const POLL_MS = 2_500;
/** A hidden tab still checks in, so coming back shows where Cuso is now. */
const HIDDEN_POLL_MS = 20_000;
/** The change request after a no, once a plan exists. */
const BRAND_CORRECTED =
  "I said no to some of your Brand Brain questions. Fit the plan to the corrected Brand Brain.";

/** Who is signed in, with the way out; closes on a click outside or Escape. */
function AccountMenu({
  overview,
  startOver,
  signOut,
}: {
  overview: CmoOverview;
  startOver: () => Promise<string | null>;
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
        <span className="dot live" aria-hidden="true" />
        <span className="ob-who-name">{hostOf(overview.websiteUrl)}</span>
        <ChevronDown size={14} aria-hidden="true" />
      </button>
      {open ? (
        <div className="ob-who-menu" role="menu">
          <ThemeToggle className="ob-who-item" role="menuitem" withLabel />
          <StartOver className="ob-who-item" startOver={startOver} />
          <form action={signOut}>
            <button type="submit" role="menuitem" className="ob-who-item">
              <LogOut size={14} aria-hidden="true" />
              Sign out
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}

interface OnboardingFlowProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  /** "connect" or "results" when a connection sends the founder back. */
  initialStep?: string;
  /** What this person skipped in hiring, from CMO's cookie. */
  skipped?: SkippedStep[];
  actions: OnboardingActions;
}

/**
 * CMO's first run: four full-screen steps from Cuso reading the site to
 * launching him. The chat becomes home once the founder starts.
 */
export function OnboardingFlow({
  overview: initialOverview,
  messages: initialMessages,
  initialStep,
  skipped: initialSkipped = [],
  actions,
}: OnboardingFlowProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [skipped, setSkipped] = useState(initialSkipped);
  // A finished step opened again from the markers; Results after a connection.
  const [viewing, setViewing] = useState<OnboardingStep | null>(
    initialStep === "results" ? "plan" : null,
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
    let last = Date.now();
    const poll = () => {
      const visible = document.visibilityState === "visible";
      if (!visible && Date.now() - last < HIDDEN_POLL_MS) return;
      last = Date.now();
      void refresh();
    };
    const timer = window.setInterval(poll, POLL_MS);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  const position = onboardingStep(overview, skipped);
  const derived = position.step;
  // A Site that finishes in this session stays on screen, done, until the
  // founder moves on: jumping ahead hid everything Cuso just did. Set while
  // rendering, so the Brand step never flashes in between.
  const [previous, setPrevious] = useState(derived);
  const [heldSite, setHeldSite] = useState(false);
  if (previous !== derived) {
    setPrevious(derived);
    setHeldSite(previous === "site" && derived === "brand");
  }
  const reached = stepIndex(derived);
  const revisiting =
    viewing !== null &&
    canRevisit(viewing, overview) &&
    stepIndex(viewing) < reached;
  const step: OnboardingStep =
    revisiting && viewing ? viewing : heldSite ? "site" : derived;
  const current = stepIndex(step);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [step]);

  // A finished step opened again leads forward to where the founder was.
  const ahead = revisiting
    ? {
        label: STEPS[reached]?.label ?? "",
        onClick: () => setViewing(null),
      }
    : undefined;

  const planPhase =
    step === derived &&
    (position.phase === "planning" || position.phase === "writing-needed")
      ? position.phase
      : "review";

  const request = async (note?: string) => {
    const result = await actions.requestStrategy(note);
    if (result.overview) setOverview(result.overview);
    return result.error;
  };

  return (
    <div className="ob">
      <header className="ob-top">
        <Logo />
        <StepMarkers
          current={current}
          reached={reached}
          open={(index) => {
            const target = STEPS[index];
            if (!target) return null;
            if (index === reached) {
              return () => {
                setViewing(null);
                setHeldSite(false);
              };
            }
            return index < reached && canRevisit(target.id, overview)
              ? () => setViewing(target.id)
              : null;
          }}
        />
        <AccountMenu
          overview={overview}
          startOver={actions.startOver}
          signOut={actions.signOut}
        />
      </header>

      <main className="ob-main" key={step}>
        {step === "site" ? (
          <SiteStep
            overview={overview}
            messages={messages}
            finished={derived === "brand"}
            skipped={skipped.includes("questions")}
            onAnswer={async (questionId, answer, note) => {
              setOverview(
                await actions.answerBrandQuestion({ questionId, answer, note }),
              );
            }}
            onSkip={async () => {
              setOverview(await actions.skipBrandQuestions());
              setSkipped((current) => [
                ...new Set([...current, "questions" as const]),
              ]);
            }}
            onContinue={() => setHeldSite(false)}
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
        ) : step === "brand" ? (
          <BrandStep
            overview={overview}
            messages={messages}
            ahead={ahead}
            onCorrect={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
            onSave={async (brandBrain) => {
              setOverview(await actions.saveBrandBrain(brandBrain));
            }}
            onAnswer={async (questionId, answer, note) => {
              setOverview(
                await actions.answerBrandQuestion({ questionId, answer, note }),
              );
            }}
            onApprove={async () => {
              setOverview(await actions.approveBrandBrain());
              // Once a plan exists, the corrected Brand Brain changes it.
              const refused = await request(
                overview.strategy ? BRAND_CORRECTED : undefined,
              );
              if (!refused) setViewing(null);
              return refused;
            }}
          />
        ) : step === "plan" ? (
          <PlanStep
            overview={overview}
            phase={planPhase}
            initialTab={initialStep === "results" ? "results" : undefined}
            ahead={ahead}
            onRequest={request}
            onSetAds={async (monthly, currency) => {
              const result = await actions.setAdBudget(monthly, currency);
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
            onAnswer={async (questionId, answer, note) => {
              setOverview(
                await actions.answerPlanQuestion({ questionId, answer, note }),
              );
            }}
            onUpdate={async () => {
              const result = await actions.applyPlanAnswers();
              if (result.overview) setOverview(result.overview);
              return result.error;
            }}
            onApprove={async () => {
              setOverview(await actions.approveStrategy());
              // Approving opens Launch.
              setViewing(null);
            }}
            onConnectMeasurement={(provider) =>
              actions.connectMeasurement(provider, "onboarding")
            }
          />
        ) : (
          <LaunchStep
            overview={overview}
            onConnect={actions.connectChannel}
            onConnectAds={actions.connectAds}
            onContinue={async () => {
              await actions.finishAccounts();
              setViewing(null);
            }}
          />
        )}
      </main>
      <footer className="ob-foot">
        <StartOver
          className="button button-ghost button-small"
          label="Use another website"
          startOver={actions.startOver}
        />
      </footer>
    </div>
  );
}
