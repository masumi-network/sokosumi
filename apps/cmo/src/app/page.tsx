import { getUsersByIdWorkspaces } from "@sokosumi/core-client";
import { headers } from "next/headers";

import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import {
  WORKSPACE_FAILED_ERROR,
  WorkspaceGate,
} from "../components/workspace-gate";
import { getAuth } from "../lib/auth";
import { asSignedInPersonInPage } from "../lib/core";
import { createAccount, signIn, signOut } from "./actions";
import { createPersonalWorkspace } from "./workspace-actions";

interface HomePageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

/** CMO's only page, so the workspace gate here gates all of CMO (ADR 0051). */
export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const { error: errorParam } = await searchParams;
  // A repeated query param arrives as a list; the first one counts.
  const error = Array.isArray(errorParam) ? errorParam[0] : errorParam;
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

  const { data, response } = await getUsersByIdWorkspaces({
    ...(await asSignedInPersonInPage(requestHeaders)),
    path: { id: "me" },
  });
  // Core revoked the token before it expired (a password change, a ban).
  if (response?.status === 401 || response?.status === 403) {
    return signedOut("signed_out");
  }
  // Never let a person in without knowing they have a workspace.
  if (!data) {
    throw new Error(`Core did not list the workspaces (${response?.status})`);
  }

  if (data.data.workspaces.length === 0) {
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
