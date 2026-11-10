import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { SignInProblem } from "../../components/sign-in-problem";
import { getAuth } from "../../lib/auth";
import { KEPT_WEBSITE_COOKIE, keptWebsite } from "../../lib/kept-website";
import { CMO_SIGN_IN_ERROR } from "../../lib/sign-in-errors";
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
  const raw = (await searchParams).error;
  const error = Array.isArray(raw) ? raw[0] : raw;
  // Home sends a session Core refuses here; sending it home again would loop.
  if (session && error !== CMO_SIGN_IN_ERROR.signedOut) redirect("/");
  if (!error) redirect("/signin");
  return (
    <SignInProblem
      error={error}
      signIn={signIn}
      website={keptWebsite((await cookies()).get(KEPT_WEBSITE_COOKIE)?.value)}
    />
  );
}
