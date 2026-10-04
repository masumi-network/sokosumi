import { headers } from "next/headers";

import { CmoWorkspace } from "../components/cmo-workspace";
import { Onboarding } from "../components/onboarding";
import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { getAuth } from "../lib/auth";
import { createAccount, signIn, signOut } from "./actions";
import {
  loadMessages,
  loadOverview,
  onboard,
  planMonth,
  saveBrandBrain,
  sendMessage,
  setAutonomy,
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
      return <Onboarding name={session.user.name} onboard={onboard} />;
    }
    return (
      <CmoWorkspace
        overview={overview}
        messages={await loadMessages().catch(() => [])}
        actions={{
          saveBrandBrain,
          planMonth,
          setAutonomy,
          loadMessages,
          sendMessage,
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
