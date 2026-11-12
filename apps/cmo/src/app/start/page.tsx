import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { Onboarding } from "../../components/onboarding";
import { getAuth } from "../../lib/auth";
import { KEPT_WEBSITE_COOKIE, keptWebsite } from "../../lib/kept-website";
import { continueWithWebsite } from "../actions";

/** Unlinked while the home page is the waitlist site; kept out of search. */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

/** Core keeps the first ten values of a sign-up context. */
const SIGN_UP_CONTEXT_LIMIT = 10;

interface StartPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * The signed-out start: the founder types the website before signing in.
 * A website kept from an earlier try fills the field. A Create account link's
 * other parameters ride along as the sign-up context.
 */
export default async function StartPage({ searchParams }: StartPageProps) {
  // Read the request first: it marks the page dynamic before getAuth reads
  // secrets that a build does not have.
  const requestHeaders = await headers();
  if (await getAuth().api.getSession({ headers: requestHeaders })) {
    redirect("/");
  }
  const signUpContext = Object.entries(await searchParams)
    .flatMap(([key, value]) => {
      const first = Array.isArray(value) ? value[0] : value;
      // The website is the field's; a link's that is not one is dropped.
      return key !== "url" && first !== undefined
        ? [[key, first] as const]
        : [];
    })
    .slice(0, SIGN_UP_CONTEXT_LIMIT);
  return (
    <Onboarding
      signedOut
      signUpContext={Object.fromEntries(signUpContext)}
      websiteUrl={keptWebsite(
        (await cookies()).get(KEPT_WEBSITE_COOKIE)?.value,
      )}
      onboard={continueWithWebsite}
    />
  );
}
