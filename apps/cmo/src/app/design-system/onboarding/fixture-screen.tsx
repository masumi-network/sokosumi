"use client";

import { NameSetup } from "../../../components/name-setup";
import { Onboarding } from "../../../components/onboarding";
import { inertOnboardingActions } from "../../../components/onboarding/actions";
import { OnboardingFlow } from "../../../components/onboarding/flow";
import { type Screen, screenOverview } from "./fixtures";

interface FixtureScreenProps {
  screen: Screen;
}

/** One onboarding screen over fixture data, for looking at without Core. */
export function FixtureScreen({ screen }: FixtureScreenProps) {
  // Before sign in: the website first.
  if (screen === "signed-out") {
    return <Onboarding signedOut onboard={async (previous) => previous} />;
  }
  // Only for an account with no name at all.
  if (screen === "name") {
    return (
      <NameSetup
        saveName={async (previous) => previous}
        signOut={async () => {}}
      />
    );
  }
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
      skipped={screen.startsWith("brand") ? ["questions"] : []}
      actions={inertOnboardingActions(overview)}
    />
  );
}
