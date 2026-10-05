import { getUsersById, getUsersByIdWorkspaces } from "@sokosumi/core-client";
import { headers } from "next/headers";

import { CmoApp } from "../components/app/cmo-app";
import { NameSetup } from "../components/name-setup";
import { Onboarding } from "../components/onboarding";
import { OnboardingFlow } from "../components/onboarding/flow";
import { OrganizationSetup } from "../components/organization-setup";
import { PendingInvitations } from "../components/pending-invitations";
import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import {
  ORGANIZATION_STEP,
  WORKSPACE_FAILED_ERROR,
  WorkspaceGate,
} from "../components/workspace-gate";
import { getAuth } from "../lib/auth";
import { readSokosumiAppBaseUrl } from "../lib/auth-config";
import { asSignedInPersonInPage } from "../lib/core";
import { isValidPersonName } from "../lib/person-name";
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
import { saveName } from "./name-actions";
import {
  createOrganizationWorkspace,
  createPersonalWorkspace,
} from "./workspace-actions";

/** A repeated query param arrives as a list; the first one counts. */
function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Core refused the token: revoked before it expired (a password change, a ban). */
function isRefused(response: Response | undefined): boolean {
  return response?.status === 401 || response?.status === 403;
}

interface HomePageProps {
  searchParams: Promise<{
    error?: string | string[];
    step?: string | string[];
    connect?: string | string[];
  }>;
}

/** CMO's only page, so the workspace gate here gates all of CMO (ADR 0051). */
export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const params = await searchParams;
  const error = first(params.error);
  const step = first(params.step);
  const signedOut = (signedOutError: string | undefined) => (
    <SignedOut
      error={signedOutError}
      createAccount={createAccount}
      signIn={signIn}
    />
  );

  if (!session) {
    // A choice made in a tab that was signed out elsewhere is not a sign-in
    // failure.
    return signedOut(error === WORKSPACE_FAILED_ERROR ? undefined : error);
  }

  const asPerson = await asSignedInPersonInPage(requestHeaders);
  const { data, response } = await getUsersByIdWorkspaces({
    ...asPerson,
    path: { id: "me" },
  });
  if (isRefused(response)) return signedOut("signed_out");
  // Never let a person in without knowing they have a workspace.
  if (!data) {
    throw new Error(`Core did not list the workspaces (${response?.status})`);
  }

  const { workspaces, pendingInvitationCount } = data.data;
  if (workspaces.length === 0) {
    // Invited people join their team on Sokosumi, which asks for any missing
    // name when they accept.
    if (pendingInvitationCount > 0) {
      return (
        <PendingInvitations
          count={pendingInvitationCount}
          sokosumiSetupUrl={`${readSokosumiAppBaseUrl()}/setup`}
          email={session.user.email}
          signOut={signOut}
        />
      );
    }
    // CMO's session holds only a display name, so the gate reads the parts.
    const person = await getUsersById({ ...asPerson, path: { id: "me" } });
    if (isRefused(person.response)) return signedOut("signed_out");
    if (!person.data) {
      throw new Error(
        `Core did not read the person (${person.response?.status})`,
      );
    }
    const { firstName, lastName } = person.data.data;
    if (!isValidPersonName(firstName ?? "", lastName ?? "")) {
      return <NameSetup saveName={saveName} signOut={signOut} />;
    }
    if (step === ORGANIZATION_STEP) {
      return (
        <OrganizationSetup
          createOrganizationWorkspace={createOrganizationWorkspace}
        />
      );
    }
    return (
      <WorkspaceGate
        failed={error === WORKSPACE_FAILED_ERROR}
        createPersonalWorkspace={createPersonalWorkspace}
        signOut={signOut}
      />
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
    return <Onboarding onboard={onboard} />;
  }
  if (!overview.onboardedAt) {
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
      initialView={step === "connect" ? "channels" : "chat"}
      connectFailed={step === "connect" && first(params.connect) === "failed"}
      actions={{
        loadState,
        sendMessage,
        approveStrategy,
        revertUpdate,
        retryLearning,
        pauseEntry,
        connectChannel,
        signOut,
      }}
    />
  );
}
