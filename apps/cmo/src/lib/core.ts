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
 * Request options that call Core `/v1` as the signed-in person from a server
 * action (ADR 0045). Actions skip the proxy, so Better Auth refreshes the
 * Sokosumi access token here when it is about to expire and writes the
 * rotated cookies.
 */
export async function asSignedInPerson(requestHeaders: Headers) {
  const { accessToken } = await getAuth().api.getAccessToken({
    body: { useAccountCookie: true },
    headers: requestHeaders,
  });
  return asPerson(accessToken);
}

/**
 * The same for CMO's onboarding actions, or home when the session is gone
 * (signed out in another tab): the home page then shows where they stand.
 */
export async function asSignedInPersonOrHome() {
  try {
    return await asSignedInPerson(await headers());
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

/**
 * A Core `/v1` client for the signed-in person in CMO's Cuso actions; null
 * when there is no usable token.
 */
export async function coreForCurrentUser() {
  return asSignedInPerson(await headers()).catch(() => null);
}
