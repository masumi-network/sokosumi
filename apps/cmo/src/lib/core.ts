import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";

import { coreClientFor, getAuth, getPageAccessToken } from "./auth";
import { readCmoAuthConfig } from "./auth-config";

function asPerson(accessToken: string) {
  return {
    client: coreClientFor(readCmoAuthConfig().coreBaseUrl),
    headers: { authorization: `Bearer ${accessToken}` },
  };
}

/**
 * Request options that call Core `/v1` as the signed-in person from one of
 * CMO's onboarding actions (ADR 0045). Actions skip the proxy, so Better Auth
 * refreshes the Sokosumi access token here when it is about to expire and
 * writes the rotated cookies. When the session is gone (signed out in another
 * tab), the person goes home, where the page shows where they stand.
 */
export async function asSignedInPersonOrHome() {
  try {
    const { accessToken } = await getAuth().api.getAccessToken({
      body: { useAccountCookie: true },
      headers: await headers(),
    });
    return asPerson(accessToken);
  } catch (error) {
    unstable_rethrow(error);
    redirect("/");
  }
}

/**
 * The same for a page render, which never refreshes the token. A render the
 * proxy skipped can find it expired; that fails into the error page, whose
 * Try again goes through the proxy and renews it.
 */
export async function asSignedInPersonInPage(requestHeaders: Headers) {
  const accessToken = await getPageAccessToken(getAuth(), requestHeaders);
  if (!accessToken) {
    throw new Error("The Sokosumi access token must be renewed first");
  }
  return asPerson(accessToken);
}
