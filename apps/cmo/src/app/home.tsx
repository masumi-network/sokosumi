import { getUsersById, getUsersByIdSignUp } from "@sokosumi/core-client";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { CmoApp } from "../components/app/cmo-app";
import { NameSetup } from "../components/name-setup";
import { Onboarding } from "../components/onboarding";
import { OnboardingFlow } from "../components/onboarding/flow";
import { SignedIn } from "../components/signed-in";
import { getAuth } from "../lib/auth";
import { asSignedInPersonInPage } from "../lib/core";
import { isValidPersonName } from "../lib/person-name";
import { CMO_SIGN_IN_ERROR } from "../lib/sign-in-errors";
import type { View } from "../lib/views";
import { signOut } from "./actions";
import {
  addMailingList,
  answerBrandQuestion,
  approveBrandBrain,
  approveStrategy,
  chooseMockPlan,
  completeOnboarding,
  connectChannel,
  connectMeasurement,
  finishAccounts,
  loadMessages,
  loadOverview,
  loadPlans,
  loadState,
  onboard,
  pauseEntry,
  requestStrategy,
  retryLearning,
  revertUpdate,
  saveBrandBrain,
  sendMessage,
  setAdBudget,
} from "./cmo-actions";
import { saveName } from "./name-actions";

/** A repeated query param arrives as a list; the first one counts. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Core refused the token: revoked before it expired (a password change, a ban). */
function isRefused(response: Response | undefined): boolean {
  return response?.status === 401 || response?.status === 403;
}

/** The sign-up origin Core records for an account created through CMO. */
const CMO_SIGN_UP_ORIGIN = "cmo";

/**
 * The website a CMO sign-up link carried (`/signup?url=`), to start the
 * hiring form with. Only a nicety: without it the person types it.
 */
async function signUpWebsite(
  asPerson: Awaited<ReturnType<typeof asSignedInPersonInPage>>,
): Promise<string | undefined> {
  const { data, response } = await getUsersByIdSignUp({
    ...asPerson,
    path: { id: "me" },
  });
  if (!data) {
    // Accounts from before sign-up recording have none.
    if (response?.status !== 404) {
      console.error(`Core did not read the sign-up (${response?.status})`);
    }
    return undefined;
  }
  const { origin, context } = data.data;
  return origin === CMO_SIGN_UP_ORIGIN && typeof context.url === "string"
    ? context.url
    : undefined;
}

export interface HomeSearchParams {
  error?: string | string[];
  step?: string | string[];
  connect?: string | string[];
}

interface HomeProps {
  searchParams: Promise<HomeSearchParams>;
  /** The app page at this address; the chat is home. */
  view: View;
}

/**
 * Every CMO page renders through here. Before onboarding ends the first run
 * owns every address.
 */
export async function Home({ searchParams, view }: HomeProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const params = await searchParams;
  const error = first(params.error);
  const step = first(params.step);
  // Signed out, the home page is the waitlist site (the proxy serves it);
  // sign-in errors and expired sessions go to the unlinked /login.
  const signedOut = (signedOutError: string | undefined): never =>
    redirect(
      signedOutError
        ? `/login?error=${encodeURIComponent(signedOutError)}`
        : "/login",
    );

  if (!session) return signedOut(error);

  const asPerson = await asSignedInPersonInPage(requestHeaders);
  // CMO's session holds only a display name, so the name step reads the parts.
  const person = await getUsersById({ ...asPerson, path: { id: "me" } });
  if (isRefused(person.response)) return signedOut(CMO_SIGN_IN_ERROR.signedOut);
  if (!person.data) {
    throw new Error(
      `Core did not read the person (${person.response?.status})`,
    );
  }

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
    const { firstName, lastName } = person.data.data;
    if (!isValidPersonName(firstName ?? "", lastName ?? "")) {
      return <NameSetup saveName={saveName} signOut={signOut} />;
    }
    // Hiring creates Cuso's own organization (ADR 0058).
    return (
      <Onboarding
        websiteUrl={await signUpWebsite(asPerson)}
        onboard={onboard}
      />
    );
  }
  if (!overview.onboardedAt) {
    // The app's pages open once onboarding ends; until then it is the first run.
    if (view !== "chat") redirect("/");
    return (
      <OnboardingFlow
        overview={overview}
        messages={await loadMessages().catch(() => [])}
        plans={await loadPlans().catch(() => null)}
        name={session.user.name}
        initialStep={step}
        actions={{
          loadState,
          sendMessage,
          retryLearning,
          requestStrategy,
          saveBrandBrain,
          approveStrategy,
          setAdBudget,
          approveBrandBrain,
          answerBrandQuestion,
          finishAccounts,
          addMailingList,
          chooseMockPlan,
          connectChannel,
          connectMeasurement,
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
      initialView={step === "connect" ? "channels" : view}
      connectFailed={step === "connect" && first(params.connect) === "failed"}
      actions={{
        loadState,
        sendMessage,
        approveStrategy,
        setAdBudget,
        revertUpdate,
        retryLearning,
        saveBrandBrain,
        pauseEntry,
        connectChannel,
        connectMeasurement,
        chooseMockPlan,
        signOut,
      }}
    />
  );
}
