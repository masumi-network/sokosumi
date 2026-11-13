import type { CmoOverview } from "@sokosumi/core-client";

/**
 * Hiring steps the person moved past without doing them: the accounts
 * ("Continue" without a connection) and Cuso's questions about the brand
 * ("Skip for now"). Only CMO's screens need them, so CMO keeps them in its
 * own cookie per Cuso's Project and Sokosumi stores nothing (ADR 0062).
 */
export type SkippedStep = "accounts" | "questions";

/** A year: a new device costs one repeated click. */
export const SKIPPED_STEPS_MAX_AGE = 60 * 60 * 24 * 365;

export function skippedStepsCookie(projectId: string): string {
  return `cmo-skipped-${projectId}`;
}

export function readSkippedSteps(value: string | undefined): SkippedStep[] {
  return (value ?? "")
    .split(",")
    .filter(
      (step): step is SkippedStep =>
        step === "accounts" || step === "questions",
    );
}

/**
 * Core's step, read from the data, moved past the accounts the person
 * skipped: on to the checkout (ADR 0068), which nothing skips, or straight
 * to done for a Cuso hired with Starter credits. Skipped questions only
 * change CMO's own screens.
 */
export function withSkippedSteps(
  overview: CmoOverview,
  skipped: readonly SkippedStep[],
): CmoOverview {
  if (overview.onboardingStep === "accounts" && skipped.includes("accounts")) {
    return {
      ...overview,
      onboardingStep: overview.billing.hiredWithStarterCredits
        ? "done"
        : "checkout",
    };
  }
  return overview;
}
