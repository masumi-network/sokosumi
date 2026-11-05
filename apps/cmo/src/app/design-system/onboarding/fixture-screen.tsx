"use client";

import type { CmoOverview } from "@sokosumi/core-client";

import { Onboarding } from "../../../components/onboarding";
import {
  type OnboardingActions,
  OnboardingFlow,
} from "../../../components/onboarding/flow";
import { type Screen, screenOverview } from "./fixtures";

/** Actions that change nothing: every call hands the same overview back. */
function inertActions(overview: CmoOverview): OnboardingActions {
  const same = async () => overview;
  const result = async () => ({ overview, error: null });
  const unavailable = async () => ({
    url: null,
    error: "Not available in the preview",
  });
  return {
    // No state, so the flow's polling never changes what is on screen.
    loadState: async () => ({ overview: null, messages: [] }),
    sendMessage: async () => {},
    retryLearning: async () => ({ overview, error: null }),
    requestStrategy: result,
    approveStrategy: same,
    setAdBudget: result,
    approveBrandBrain: same,
    answerBrandQuestion: same,
    skipBrandQuestions: same,
    saveBrandBrain: same,
    answerPlanQuestion: same,
    applyPlanAnswers: result,
    finishAccounts: () => new Promise<never>(() => {}),
    connectChannel: unavailable,
    connectMeasurement: unavailable,
    connectAds: unavailable,
    startOver: async () => null,
    signOut: async () => {},
  };
}

/** One onboarding screen over fixture data, for looking at without Core. */
export function FixtureScreen({ screen }: { screen: Screen }) {
  if (screen === "hire") {
    return (
      <Onboarding onboard={async (previous) => previous} websiteUrl="acme.io" />
    );
  }
  const overview = screenOverview(screen);
  return (
    <OnboardingFlow
      overview={overview}
      messages={[]}
      // The Brand screen shows its questions-left line when they were skipped.
      skipped={screen === "brand" ? ["questions"] : []}
      actions={inertActions(overview)}
    />
  );
}
