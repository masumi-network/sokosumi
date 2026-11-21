"use client";

import "./onboarding.css";

import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";
import { useCallback, useState } from "react";
import { useOnboardingPoll } from "../../hooks/effects/use-onboarding-poll";
import { useOnboardingReturnNotice } from "../../hooks/effects/use-onboarding-return-notice";
import { useOnboardingStepScroll } from "../../hooks/effects/use-onboarding-step-scroll";
import type { CusoMessage } from "../../lib/chat-messages";
import { cusoSubscribed } from "../../lib/cuso-subscribed";
import type { SkippedStep } from "../../lib/skipped-steps";
import { AccountMenu } from "../account-menu";
import { subscribeOffer } from "../app/paused";
import { hostOf } from "../brand-profile";
import { Logo } from "../logo";
import { StartOver } from "../start-over";
import { skipOffer, topUpOffer } from "../top-up";
import { type AnswerInput, type OnboardingActions } from "./actions";
import { BrandStep } from "./brand-step";
import { CheckoutStep } from "./checkout-step";
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

interface OnboardingFlowProps {
  overview: CmoOverview;
  messages: CusoMessage[];
  /** "results" when a measurement connection sends the founder back to it. */
  initialStep?: "results" | undefined;
  /** Why a measurement connection that sent the founder back did not finish. */
  measureError?: string | null;
  /** What this person skipped in hiring, from CMO's cookie. */
  skipped?: SkippedStep[];
  /** The CMO plans the checkout step offers; empty when Core could not read them. */
  plans?: CmoSubscriptionPlan[];
  /** This page is Polar's return after a payment. */
  returnedFromCheckout?: boolean;
  actions: OnboardingActions;
}

/**
 * CMO's first run: five full-screen steps from Cuso reading the site to
 * paying for and launching him. The chat becomes home once the founder
 * starts.
 */
export function OnboardingFlow({
  overview: initialOverview,
  messages: initialMessages,
  initialStep,
  measureError = null,
  skipped: initialSkipped = [],
  plans = [],
  returnedFromCheckout = false,
  actions,
}: OnboardingFlowProps) {
  const [overview, setOverview] = useState(initialOverview);
  const [messages, setMessages] = useState(initialMessages);
  const [skipped, setSkipped] = useState(initialSkipped);
  // Back from Polar, until the payment shows or the person says they did not pay.
  const [confirming, setConfirming] = useState(returnedFromCheckout);
  // A finished step opened again from the markers; Results after a connection.
  const [viewing, setViewing] = useState<OnboardingStep | null>(
    initialStep === "results" ? "plan" : null,
  );
  // Why a connection came back without an account, read before the query goes.
  const returnNotice = useOnboardingReturnNotice(returnedFromCheckout);
  // One-shot measurement return error: consumed when leaving Results or Plan so
  // revisiting Brand and returning to Strategy never replays it.
  const [pendingMeasureError, setPendingMeasureError] = useState(measureError);

  const refresh = useCallback(async () => {
    const state = await actions.loadState().catch(() => null);
    if (!state?.overview) return;
    if (confirming && state.overview.onboardingStep !== "checkout") {
      // Paid with an account already connected (the old order): hiring is
      // over, so the page loads again as the app, on the chat.
      if (state.overview.onboardingStep === "done") {
        window.location.assign(
          `/?project=${encodeURIComponent(state.overview.projectId)}`,
        );
        return;
      }
      // Paid: on to the accounts and Launch, without Polar's return address.
      setConfirming(false);
      window.history.replaceState(null, "", "/");
    }
    setOverview(state.overview);
    setMessages(state.messages);
  }, [actions, confirming]);

  useOnboardingPoll(refresh, {
    pollMs: POLL_MS,
    hiddenPollMs: HIDDEN_POLL_MS,
  });

  const position = onboardingStep(overview, skipped, {
    returnedFromCheckout: confirming,
  });
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
  const [prevStep, setPrevStep] = useState(step);
  if (prevStep !== step) {
    setPrevStep(step);
    if (prevStep === "plan" && pendingMeasureError !== null) {
      setPendingMeasureError(null);
    }
  }
  const current = stepIndex(step);
  useOnboardingStepScroll(step);

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
  const strategyStarted =
    overview.work?.kind === "strategy" || Boolean(overview.strategy);
  if (planRequested && strategyStarted) {
    setPlanRequested(false);
  }
  const starting =
    planRequested &&
    !strategyStarted &&
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
  const topUp = topUpOffer(overview, actions.startTopUp);
  // A tester continues without a subscription; the refresh moves the
  // wizard on once Core counts his Tester credits.
  const skip = skipOffer(overview, async () => {
    const { error } = await actions.skipSubscription();
    if (!error) await refresh();
    return error;
  });
  // A Cuso with Tester credits can run out before his plan: the
  // monthly plans, cheapest first, as in the app (Polar lets him switch).
  const subscribe = subscribeOffer(overview, () =>
    actions.startPlanCheckout("month"),
  );

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
          label={hostOf(overview.websiteUrl)}
          startOver={actions.startOver}
          subscribed={cusoSubscribed(overview)}
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
            topUp={topUp}
            subscribe={subscribe}
            skip={skip}
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
            onFix={async (section, note) => {
              const refused = await actions.fixBrandSection(section, note);
              await refresh();
              return refused;
            }}
            onSave={async (brandBrain) => {
              setOverview(await actions.saveBrandBrain(brandBrain));
            }}
            onAnswer={(questionId, answer, note) =>
              answerBrand({ questionId, answer, note })
            }
            onApprove={async () => {
              setOverview(await actions.approveBrandBrain());
              // Cuso starts the plan when the research ends, so it is often
              // written or under way: asking again hands back the one he is
              // writing. A no is already Core's to fix on its section.
              const refused = overview.strategy ? null : await request();
              if (!refused) setViewing(null);
              return refused;
            }}
            topUp={topUp}
            subscribe={subscribe}
            skip={skip}
          />
        ) : step === "plan" ? (
          <PlanStep
            overview={overview}
            phase={planPhase}
            starting={starting}
            initialTab={initialStep === "results" ? "results" : undefined}
            measureError={pendingMeasureError}
            onConsumeMeasureError={() => setPendingMeasureError(null)}
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
              // Approving opens Subscribe, or Launch with Tester credits.
              setViewing(null);
            }}
            onConnectMeasurement={(provider) =>
              actions.connectMeasurement(provider, "onboarding")
            }
            topUp={topUp}
            subscribe={subscribe}
            skip={skip}
          />
        ) : step === "checkout" ? (
          <CheckoutStep
            plans={plans}
            phase={position.step === "checkout" ? position.phase : "choosing"}
            strategy={overview.approvedStrategy ?? overview.strategy}
            onCheckout={actions.startPlanCheckout}
            skip={skip}
            onShowPlans={() => {
              setConfirming(false);
              window.history.replaceState(null, "", "/");
            }}
          />
        ) : (
          <LaunchStep
            overview={overview}
            onConnect={actions.connectChannel}
            onConnectAds={actions.connectAds}
            onConnectMeasurement={(provider) =>
              actions.connectMeasurement(provider, "launch")
            }
            onSetPresenter={actions.setPresenter}
            onClearPresenter={actions.clearPresenter}
            notice={returnNotice}
            // Core is done at the first connection, so the celebration is
            // client-only. Go to Today records the finish in a cookie, and a
            // cookie written in a server action re-renders the page into the
            // app; its redirect is no failure to show.
            onGoToday={() => {
              actions.finishAccounts().catch(() => {});
            }}
          />
        )}
      </main>
      <footer className="ob-foot">
        <p className="ob-small muted">
          You can close this page and come back any time to continue.
        </p>
        <StartOver
          className="button button-ghost button-small"
          label="Use another website"
          startOver={actions.startOver}
          subscribed={cusoSubscribed(overview)}
        />
      </footer>
    </div>
  );
}
