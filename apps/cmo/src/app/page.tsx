import { getUsersByIdWorkspaces } from "@sokosumi/core-client";
import { headers } from "next/headers";

import { SignedIn } from "../components/signed-in";
import { SignedOut } from "../components/signed-out";
import { WorkspaceGate } from "../components/workspace-gate";
import { getAuth } from "../lib/auth";
import { asSignedInPerson } from "../lib/core";
import { createAccount, signIn, signOut } from "./actions";
import { createPersonalWorkspace } from "./workspace-actions";

interface HomePageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  const { error } = await searchParams;

  if (session) {
    // A person with no workspace cannot use CMO yet (ADR 0051). A failed
    // read throws into the error page rather than letting them in.
    const { data } = await getUsersByIdWorkspaces({
      ...(await asSignedInPerson(requestHeaders)),
      path: { id: "me" },
      throwOnError: true,
    });
    if (data.data.workspaces.length === 0) {
      return (
        <WorkspaceGate
          failed={error === "workspace_failed"}
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

  return (
    <SignedOut
      error={typeof error === "string" ? error : undefined}
      createAccount={createAccount}
      signIn={signIn}
    />
  );
}
