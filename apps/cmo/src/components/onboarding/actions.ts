import type { CmoOverview, CmoSubscriptionPlan } from "@sokosumi/core-client";

import type { CusoMessage } from "../../lib/chat-messages";
import type { AdActions } from "../ads";
import type { StartTopUp } from "../top-up";
import type { Answer } from "./questions";

/** One answer to one of Cuso's questions, with what is true instead after a no. */
export interface AnswerInput {
  questionId: string;
  answer: Answer;
  note?: string;
}

/** Load and talk while Cuso reads the site. */
export interface OnboardingResearchActions {
  loadState: () => Promise<{
    overview: CmoOverview | null;
    messages: CusoMessage[];
  }>;
  sendMessage: (content: string) => Promise<void>;
  retryLearning: () => Promise<{
    overview: CmoOverview;
    error: string | null;
  }>;
}

/** Confirm and correct the Brand Brain. */
export interface OnboardingBrandActions {
  approveBrandBrain: () => Promise<CmoOverview>;
  answerBrandQuestion: (answer: AnswerInput) => Promise<CmoOverview>;
  skipBrandQuestions: () => Promise<CmoOverview>;
  saveBrandBrain: (
    brandBrain: NonNullable<CmoOverview["brandBrain"]>,
  ) => Promise<CmoOverview>;
}

/** Ask for, check, and approve the plan. */
export interface OnboardingPlanActions {
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
  answerPlanQuestion: (answer: AnswerInput) => Promise<CmoOverview>;
  applyPlanAnswers: () => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
}

/** Connect accounts and leave hiring for the app. */
export interface OnboardingConnectActions {
  /** Records that the founder launched, so the checkout or the chat opens next. */
  finishAccounts: () => Promise<never>;
  connectChannel: (
    provider: "x" | "linkedin" | "instagram" | "facebook" | "youtube",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectMeasurement: (
    provider: CmoOverview["measurement"][number]["provider"],
    from: "onboarding" | "app",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectAds: AdActions["connectAds"];
}

/** Pay for a CMO plan, the last step of hiring. */
export interface OnboardingCheckoutActions {
  /** Starts Polar's checkout; the browser goes to the returned URL. */
  startPlanCheckout: (
    interval: CmoSubscriptionPlan["interval"],
    /** The plan Polar opens on; without one, the cheapest. */
    tier?: string,
  ) => Promise<{ url: string | null; error: string | null }>;
}

/** Account menu: start over or sign out; and the top-up a refusal offers. */
export interface OnboardingAccountActions {
  /** Archives this Cuso and opens the hiring form; a refusal comes back as text. */
  startOver: () => Promise<string | null>;
  /** Starts the checkout for a Project top-up of this Cuso. */
  startTopUp: StartTopUp;
  /** A tester continues without a subscription; a refusal comes back as text. */
  skipSubscription: () => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

/**
 * Everything the onboarding flow can ask of Core. Split into the six
 * capability ports above so a caller can learn one group at a time; the flow
 * still takes the full bag.
 */
export type OnboardingActions = OnboardingResearchActions &
  OnboardingBrandActions &
  OnboardingPlanActions &
  OnboardingConnectActions &
  OnboardingCheckoutActions &
  OnboardingAccountActions;

/**
 * Actions that change nothing: every call hands the same overview back.
 * Design-system fixtures and tests that only care about a few methods start
 * here and override what they exercise.
 */
export function inertOnboardingActions(
  overview: CmoOverview,
): OnboardingActions {
  const same = async () => overview;
  const result = async () => ({ overview, error: null });
  const unavailable = async () => ({
    url: null,
    error: "Not available in the preview",
  });
  return {
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
    startPlanCheckout: unavailable,
    startOver: async () => null,
    startTopUp: unavailable,
    skipSubscription: async () => ({ error: null }),
    signOut: async () => {},
  };
}
