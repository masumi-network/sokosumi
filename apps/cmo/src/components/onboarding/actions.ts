import type { CmoOverview } from "@sokosumi/core-client";

import type { BrandSectionKey } from "../../lib/brand-sections";
import type { CusoMessage } from "../../lib/chat-messages";
import type { AdActions } from "../ads";

/** Yes, no or not sure, to one of Cuso's yes/no questions. */
export type Answer = "yes" | "no" | "unsure";

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
  /**
   * The founder says something is wrong: with a section Cuso rewrites only
   * it; without one he rewrites every section the note changes. Now or once
   * his current turn ends. A refusal comes back as text.
   */
  fixBrandSection: (
    section: BrandSectionKey | null,
    note: string,
  ) => Promise<string | null>;
}

/** Ask for, check, and approve the plan. */
export interface OnboardingPlanActions {
  /** With `patch`, the note changes only the entries it touches. */
  requestStrategy: (
    note?: string,
    patch?: boolean,
  ) => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
  /** Try again: Core replaces a plan running past twice the usual time. */
  restartStrategy: () => Promise<{
    overview: CmoOverview | null;
    error: string | null;
  }>;
  approveStrategy: () => Promise<CmoOverview>;
  /** The owner's own monthly ad budget; Cuso patches the ads around it. */
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
  /** Records that the founder launched, so the app opens on the chat next. */
  finishAccounts: () => Promise<never>;
  connectChannel: (
    provider: "x" | "linkedin" | "instagram" | "facebook" | "youtube",
    from?: "onboarding" | "popup",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectMeasurement: (
    provider: CmoOverview["measurement"][number]["provider"],
    from: "onboarding" | "app",
  ) => Promise<{ url: string | null; error: string | null }>;
  connectAds: AdActions["connectAds"];
}

/** Account menu: start over or sign out. */
export interface OnboardingAccountActions {
  /** Archives this Cuso and opens the hiring form; a refusal comes back as text. */
  startOver: () => Promise<string | null>;
  signOut: () => Promise<void>;
}

/**
 * Everything the onboarding flow can ask of Core. Split into the five
 * capability ports above so a caller can learn one group at a time; the flow
 * still takes the full bag.
 */
export type OnboardingActions = OnboardingResearchActions &
  OnboardingBrandActions &
  OnboardingPlanActions &
  OnboardingConnectActions &
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
    restartStrategy: result,
    approveStrategy: same,
    setAdBudget: result,
    approveBrandBrain: same,
    answerBrandQuestion: same,
    skipBrandQuestions: same,
    saveBrandBrain: same,
    fixBrandSection: async () => null,
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
