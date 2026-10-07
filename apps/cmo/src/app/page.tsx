import {
  getUsersById,
  getUsersByIdSignUp,
  getUsersByIdWorkspaces,
} from "@sokosumi/core-client";
import { headers } from "next/headers";

import { NameSetup } from "../components/name-setup";
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
import { CMO_SIGN_IN_ERROR } from "../lib/sign-in-errors";
import { createAccount, signIn, signOut } from "./actions";
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

/**
 * The website a CMO sign-up link carried (`/signup?url=`), to start the
 * organization step with. Only a nicety: without it the person types it.
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
  return origin === "cmo" && typeof context.url === "string"
    ? context.url
    : undefined;
}

interface HomePageProps {
  searchParams: Promise<{
    error?: string | string[];
    step?: string | string[];
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
  if (isRefused(response)) return signedOut(CMO_SIGN_IN_ERROR.signedOut);
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
    if (isRefused(person.response))
      return signedOut(CMO_SIGN_IN_ERROR.signedOut);
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
          websiteUrl={await signUpWebsite(asPerson)}
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
  return (
    <SignedIn
      name={session.user.name}
      email={session.user.email}
      signOut={signOut}
    />
  );
}
