"use client";

import "./onboarding.css";

import type { CmoOverview } from "@sokosumi/core-client";
import { ChevronDown, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import type { CusoMessage } from "../../lib/chat-messages";
import type { SkippedStep } from "../../lib/skipped-steps";
import { adsReturnError } from "../ads";
import { hostOf } from "../brand-profile";
import { Logo } from "../logo";
import { StartOver } from "../start-over";
import { ThemeToggle } from "../theme-toggle";
import { TypeIn } from "../type-in";
import { type AnswerInput, type OnboardingActions } from "./actions";
import { BrandStep } from "./brand-step";
import { Checklist, useElapsedSeconds } from "./checklist";
import { LaunchStep } from "./launch-step";
import {
  liveLine,
  researchGroups,
  slowCopy,
  stepTitle,
  USUAL_SECONDS,
} from "./live";
import { PlanStep } from "./plan-step";
import { RetryButton } from "./questions";
import { Refusal } from "./refusal";
import { SiteStep } from "./site-step";
import { type OnboardingStep, onboardingStep, STEPS, stepIndex } from "./step";
import { StepMarkers } from "./step-markers";

interface ResearchChipsProps {
  overview: CmoOverview;
}

/**
 * The research's six groups under the live line, on Site: each ticks off
 * as Cuso saves its sections. A group the read never reached stays open.
 */
function ResearchChips({ overview }: ResearchChipsProps) {
  const groups = researchGroups(overview);
  if (!groups) return null;
  const reading =
    overview.work?.kind === "research" && overview.work.status === "running";
  return (
    <Checklist
      className="ob-chips"
      items={groups.map((group) => ({
        label: group.label,
        state: group.state === "done" ? "done" : reading ? "working" : "next",
      }))}
    />
  );
}

/** The steps the founder can open again once past them; Site only leads to Brand. */
function canRevisit(step: OnboardingStep, overview: CmoOverview): boolean {
  if (step === "brand") return overview.brandBrain !== null;
  return step === "plan" && overview.strategy !== null;
}

const POLL_MS = 2_500;
/** A hidden tab still checks in, so coming back shows where Cuso is now. */
const HIDDEN_POLL_MS = 20_000;

interface AccountMenuProps {
  overview: CmoOverview;
  startOver: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/** Who is signed in, with the way out; closes on a click outside or Escape. */
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

interface LiveLineProps {
  overview: CmoOverview;
  /** Asked for the plan, before Core reports the work. */
  starting: boolean;
  onRetry: () => Promise<string | null>;
  topUpUrl: string;
}

/**
 * One line under the heading: what Cuso is doing now, from Core's work
 * labels, and the time so far against the usual. Past twice the usual time
 * it offers Try again (Core restarts the slow run; an older Core first needs
 * five quiet minutes). It keeps its height when nothing runs.
 */
function LiveLine({ overview, starting, onRetry, topUpUrl }: LiveLineProps) {
  const live = liveLine(overview);
  const elapsed = useElapsedSeconds(live?.work.startedAt, live !== null);
  const quiet = useElapsedSeconds(live?.lastAt, live !== null);
  const label = live?.label ?? (starting ? "Planning your month" : "");
  const slow =
    live && elapsed !== null
      ? slowCopy(
          elapsed,
          USUAL_SECONDS[live.work.kind],
          quiet ?? 0,
          researchGroups(overview) !== null,
        )
      : null;
  return (
    <div className="ob-live-line">
      {label ? (
        <>
          <span className="dot live" aria-hidden="true" />
          <span className="ob-live-what">
            <TypeIn text={label} />
          </span>
          {slow ? <span className="muted num">{slow.line}</span> : null}
          {slow?.retry ? (
            <RetryButton onRetry={onRetry} topUpUrl={topUpUrl} small />
          ) : null}
        </>
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
 * CMO's first run: one screen that changes in place from Cuso reading the
 * site to launching him. The heading, the live line and the step markers sit
 * above the step and never remount. The chat becomes home once the founder
 * starts.
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
  const request = async (note?: string, patch?: boolean) => {
    setPlanRequested(true);
    try {
      const refused = settle(await actions.requestStrategy(note, patch));
      if (refused) setPlanRequested(false);
      return refused;
    } catch (error) {
      setPlanRequested(false);
      throw error;
    }
  };
  // Why Core refused the founder's last fix, shown under the heading.
  const [fixRefusal, setFixRefusal] = useState<string | null>(null);
  const fixSection = async (
    section: Parameters<OnboardingActions["fixBrandSection"]>[0],
    note: string,
  ) => {
    const refused = await actions.fixBrandSection(section, note);
    setFixRefusal(refused);
    return refused;
  };
  const answerBrand = async (input: AnswerInput) => {
    setOverview(await actions.answerBrandQuestion(input));
    // While Cuso reads, the plan he starts next takes the no in. Afterwards
    // it is a fix to its one section, which Core runs now or once his
    // current turn ends.
    const question = overview.brandBrain?.questions?.find(
      (candidate) => candidate.id === input.questionId,
    );
    const reading =
      overview.work?.kind === "research" && overview.work.status === "running";
    if (input.answer !== "no" || !question || reading) return;
    await fixSection(
      question.section,
      input.note?.trim() || `Not true: ${question.statement}`,
    );
  };
  const retryLearning = async () => {
    const result = await actions.retryLearning();
    setOverview(result.overview);
    return result.error;
  };
  // Launch was pressed: the heading says Cuso is live.
  const [launched, setLaunched] = useState(false);
  const sitePhase = position.step === "site" ? position.phase : "asking";
  const planRunning =
    starting ||
    (overview.work?.kind === "strategy" && overview.work.status === "running");
  const title =
    step === "site"
      ? stepTitle({
          step,
          overview,
          messages,
          phase: sitePhase,
          finished: derived !== "site",
        })
      : step === "plan"
        ? stepTitle({ step, overview, phase: planPhase, running: planRunning })
        : step === "launch"
          ? stepTitle({ step, overview, launched })
          : stepTitle({ step, overview });

  return (
    <div className="ob ob-shell">
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

      <main className={`ob-main ob-main-${step}`}>
        <div className="ob-head">
          <h1 className="ob-h1">
            <TypeIn text={title} />
          </h1>
          <LiveLine
            overview={overview}
            starting={starting}
            onRetry={
              overview.work?.kind !== "strategy"
                ? retryLearning
                : researchGroups(overview)
                  ? async () => settle(await actions.restartStrategy())
                  : () => request()
            }
            topUpUrl={overview.subscribeUrl}
          />
          {step === "site" ? <ResearchChips overview={overview} /> : null}
          {/* Fixes are asked on Site and Brand; the refusal stays there. */}
          {fixRefusal && (step === "site" || step === "brand") ? (
            <Refusal text={fixRefusal} topUpUrl={overview.subscribeUrl} />
          ) : null}
        </div>
        {step === "site" ? (
          <SiteStep
            overview={overview}
            messages={messages}
            phase={sitePhase}
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
            onRetry={retryLearning}
            onReply={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
          />
        ) : step === "brand" ? (
          <BrandStep
            titled={false}
            overview={overview}
            messages={messages}
            ahead={ahead}
            onCorrect={async (text) => {
              await actions.sendMessage(text);
              await refresh();
            }}
            onFix={async (section, note) => {
              const refused = await fixSection(section, note);
              if (refused) throw new Error(refused);
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
              // Core starts the plan when the research ends, and again once a
              // fix that ran first lands: confirming starts nothing while Cuso
              // writes a plan or a fix, or once a plan is written.
              const busy =
                overview.work?.kind === "strategy" &&
                overview.work.status === "running";
              if (overview.strategy !== null || busy) {
                setViewing(null);
                return null;
              }
              const refused = await request();
              if (!refused) setViewing(null);
              return refused;
            }}
          />
        ) : step === "plan" ? (
          <PlanStep
            titled={false}
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
            onCelebrate={setLaunched}
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
