import { headers } from "next/headers";

import { CmoApp } from "../components/app/cmo-app";
import { Onboarding } from "../components/onboarding";
import { OnboardingFlow } from "../components/onboarding/flow";
import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { getAuth } from "../lib/auth";
import { createAccount, signIn, signOut } from "./actions";
import {
  approveStrategy,
  completeOnboarding,
  connectChannel,
  loadMessages,
  loadOverview,
  loadPlans,
  loadState,
  onboard,
  pauseEntry,
  requestStrategy,
  retryLearning,
  revertUpdate,
  sendMessage,
} from "./cmo-actions";

interface HomePageProps {
  searchParams: Promise<{
    error?: string | string[];
    step?: string | string[];
  }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) {
    const overview = await loadOverview().catch(() => undefined);
    // Core unreachable: keep the signed-in shell rather than an error page.
    if (overview === undefined) {
      return (
        <SignedIn
          name={session.user.name}
          email={session.user.email}
          signOut={signOut}
        />
      );
    }
    if (overview === null) {
      return <Onboarding onboard={onboard} />;
    }
    if (!overview.onboardedAt) {
      const { step } = await searchParams;
      return (
        <OnboardingFlow
          overview={overview}
          messages={await loadMessages().catch(() => [])}
          plans={await loadPlans().catch(() => null)}
          name={session.user.name}
          initialStep={typeof step === "string" ? step : undefined}
          actions={{
            loadState,
            sendMessage,
            retryLearning,
            requestStrategy,
            approveStrategy,
            connectChannel,
            completeOnboarding,
            signOut,
          }}
        />
      );
    }
    return (
      <CmoApp
        overview={overview}
        messages={await loadMessages().catch(() => [])}
        name={session.user.name}
        email={session.user.email}
        actions={{
          loadState,
          sendMessage,
          approveStrategy,
          revertUpdate,
          retryLearning,
          pauseEntry,
          signOut,
        }}
      />
    );
  }

  const { error } = await searchParams;
  return (
    <SignedOut
      error={typeof error === "string" ? error : undefined}
      createAccount={createAccount}
      signIn={signIn}
    />
  );
}
