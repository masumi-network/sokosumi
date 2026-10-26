import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignedOut } from "../../components/signed-out";
import { WORKSPACE_FAILED_ERROR } from "../../components/workspace-gate";
import { getAuth } from "../../lib/auth";
import { createAccount, signIn } from "../actions";

/** Unlinked while the home page is the waitlist site; kept out of search. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

/** Create account and sign in, with any error a sign in sent back. */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Read the request first: it marks the page dynamic before getAuth reads
  // secrets that a build does not have.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/");
  const raw = (await searchParams).error;
  const error = Array.isArray(raw) ? raw[0] : raw;
  return (
    <SignedOut
      // A choice made in a tab that was signed out elsewhere is not a
      // sign-in failure.
      error={error === WORKSPACE_FAILED_ERROR ? undefined : error}
      createAccount={createAccount}
      signIn={signIn}
    />
  );
}
