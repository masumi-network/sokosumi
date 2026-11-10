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

/**
 * The signed-out start: the founder types the website before signing in.
 * A website kept from an earlier try fills the field.
 */
export default async function StartPage() {
  // Read the request first: it marks the page dynamic before getAuth reads
  // secrets that a build does not have.
  const requestHeaders = await headers();
  if (await getAuth().api.getSession({ headers: requestHeaders })) {
    redirect("/");
  }
  return (
    <Onboarding
      signedOut
      websiteUrl={keptWebsite(
        (await cookies()).get(KEPT_WEBSITE_COOKIE)?.value,
      )}
      onboard={continueWithWebsite}
    />
  );
}
