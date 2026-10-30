import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignInProblem } from "../../components/sign-in-problem";
import { getAuth } from "../../lib/auth";
import { signIn } from "../actions";

/** Unlinked while the home page is the waitlist site; kept out of search. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

interface LoginPageProps {
  searchParams: Promise<{ error?: string | string[] }>;
}

/**
 * Where a failed sign in lands. Without an error there is nothing to say, so
 * it goes straight on to Sokosumi's Log in.
 */
export default async function LoginPage({ searchParams }: LoginPageProps) {
  // Read the request first: it marks the page dynamic before getAuth reads
  // secrets that a build does not have.
  const requestHeaders = await headers();
  const session = await getAuth().api.getSession({ headers: requestHeaders });
  if (session) redirect("/");
  const raw = (await searchParams).error;
  const error = Array.isArray(raw) ? raw[0] : raw;
  if (!error) redirect("/signin");
  return <SignInProblem error={error} signIn={signIn} />;
}
