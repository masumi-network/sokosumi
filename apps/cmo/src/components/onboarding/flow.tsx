"use client";

import "./onboarding.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { ChevronDown, LogOut, Users } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AGENT_NAME } from "../../lib/agent";
import type { CusoMessage } from "../../lib/chat-messages";
import type { SkippedStep } from "../../lib/skipped-steps";
import { adsReturnError } from "../ads";
import { hostOf } from "../brand-profile";
import { Logo } from "../logo";
import { StartOver } from "../start-over";
import { ThemeToggle } from "../theme-toggle";
import { type AnswerInput, type OnboardingActions } from "./actions";
import { BrandStep } from "./brand-step";
import { LaunchStep } from "./launch-step";
import { PlanStep } from "./plan-step";
import { SiteStep } from "./site-step";
import { type OnboardingStep, onboardingStep, STEPS, stepIndex } from "./step";
import { StepMarkers } from "./step-markers";

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

interface AccountMenuProps {
  overview: CmoOverview;
  startOver: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/**
 * Who is signed in, the Cuso picker and the way out; closes on a click
 * outside or Escape.
 */
function AccountMenu({ overview, startOver, signOut }: AccountMenuProps) {
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
          <a className="ob-who-item" role="menuitem" href="/?cusos=1">
            <Users size={14} aria-hidden="true" />
            Your {AGENT_NAME}s
          </a>
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
  /** "results" when a measurement connection sends the founder back to it. */
  initialStep?: "results" | undefined;
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
  // Why a connection came back without an account, read before the query goes.
  const [returnNotice, setReturnNotice] = useState<string | null>(null);

  // The connection redirect's query has been read; a reload routes from Core.
  useEffect(() => {
    const failed =
      new URLSearchParams(window.location.search).get("connect") === "failed";
    setReturnNotice(
      failed ? "That connection didn't finish. Try again." : adsReturnError(),
    );
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
    setHeldSite(
      previous === "site" && (derived === "brand" || derived === "plan"),
    );
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

  // Asked for the plan this session: it is being written, even before Core
  // reports the work, so the button is not offered a second time.
  const [planRequested, setPlanRequested] = useState(false);
  useEffect(() => {
    if (
      planRequested &&
      (overview.work?.kind === "strategy" || overview.strategy)
    ) {
      setPlanRequested(false);
    }
  }, [planRequested, overview.work, overview.strategy]);
  const starting =
    planRequested &&
    position.step === "plan" &&
    position.phase === "writing-needed";
  const planPhase =
    position.step === "plan" && step === derived
      ? starting
        ? "planning"
        : position.phase
      : "review";

  /** Keeps the overview a call brought back; its error, if any, is the answer. */
  const settle = (result: {
    overview: CmoOverview | null;
    error: string | null;
  }) => {
    if (result.overview) setOverview(result.overview);
    return result.error;
  };
  const request = async (note?: string) => {
    setPlanRequested(true);
    try {
      const refused = settle(await actions.requestStrategy(note));
      if (refused) setPlanRequested(false);
      return refused;
    } catch (error) {
      setPlanRequested(false);
      throw error;
    }
  };
  const answerBrand = async (input: AnswerInput) => {
    setOverview(await actions.answerBrandQuestion(input));
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
            phase={position.step === "site" ? position.phase : "asking"}
            next={derived === "plan" ? "plan" : "brand"}
            finished={derived !== "site"}
            skipped={skipped.includes("questions")}
            onAnswer={(questionId, answer, note) =>
              answerBrand({ questionId, answer, note })
            }
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
            onAnswer={(questionId, answer, note) =>
              answerBrand({ questionId, answer, note })
            }
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
            starting={starting}
            initialTab={initialStep === "results" ? "results" : undefined}
            ahead={ahead}
            onRequest={request}
            onSetAds={async (monthly, currency) =>
              settle(await actions.setAdBudget(monthly, currency))
            }
            onAnswer={async (questionId, answer, note) => {
              setOverview(
                await actions.answerPlanQuestion({ questionId, answer, note }),
              );
            }}
            onUpdate={async () => settle(await actions.applyPlanAnswers())}
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
            notice={returnNotice}
            // Launch needs a connected network, and Core ends hiring on the
            // first connection, so the celebration is client-only. Recording
            // the finish sets a cookie, and a cookie written in a server
            // action re-renders the page into the app: it runs on Go to Today.
            onLaunch={async () => {}}
            onGoToday={() => void actions.finishAccounts()}
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
