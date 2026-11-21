"use client";

import { useEffect } from "react";

import type { OnboardingStep } from "../../components/onboarding/step";

/**
 * Scrolls the onboarding page back to the top whenever the active step changes.
 */
export function useOnboardingStepScroll(step: OnboardingStep): void {
  useEffect(() => {
    void step;
    window.scrollTo(0, 0);
  }, [step]);
}
