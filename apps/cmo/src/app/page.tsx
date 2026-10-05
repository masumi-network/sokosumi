import { headers } from "next/headers";

import { CmoApp } from "../components/app/cmo-app";
import { Onboarding } from "../components/onboarding";
import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { getAuth } from "../lib/auth";
import { createAccount, signIn, signOut } from "./actions";
import {
  approveStrategy,
  loadMessages,
  loadOverview,
  loadState,
  onboard,
  pauseEntry,
  retryLearning,
  revertUpdate,
  sendMessage,
} from "./cmo-actions";

interface HomePageProps {
  searchParams: Promise<{ error?: string | string[] }>;
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
