"use client";

import { Onboarding } from "../../../components/onboarding";
import { inertOnboardingActions } from "../../../components/onboarding/actions";
import { OnboardingFlow } from "../../../components/onboarding/flow";
import { type Screen, screenOverview } from "./fixtures";

interface FixtureScreenProps {
  screen: Screen;
}

/** One onboarding screen over fixture data, for looking at without Core. */
export function FixtureScreen({ screen }: FixtureScreenProps) {
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
      skipped={
        screen === "brand" ||
        screen === "brand-planning" ||
        screen === "brand-fixed"
          ? ["questions"]
          : []
      }
      actions={inertOnboardingActions(overview)}
    />
  );
}
