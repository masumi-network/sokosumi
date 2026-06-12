import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { auth, type Session } from "@/lib/auth/auth";
import { buildAuthRequestHeadersForForwarding } from "@/lib/auth/forward-cookies";

interface GetSessionOptions {
  refresh?: boolean;
}

/**
 * Gets the current user's session information. This function only works with
 * session-based authentication, not API keys.
 *
 * @returns Promise resolving to the user's session if valid, null otherwise
 *
 */
const getCachedSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: await buildAuthRequestHeadersForForwarding(),
  });

  return session;
});

export async function getSession(
  options?: GetSessionOptions,
): Promise<Session | null> {
  if (options?.refresh) {
    return auth.api.getSession({
      query: {
        disableCookieCache: true,
      },
      headers: await buildAuthRequestHeadersForForwarding(),
    });
  }

  return getCachedSession();
}

/**
 * Gets the current user's session or redirects to the login page if no valid session is found.
 * This is useful for protecting routes that require session-based authentication.
 *
 * @returns Promise resolving to the user's session if authenticated
 * @throws {NextError} Redirects to login page with return URL when not authenticated
 */
export async function getSessionOrRedirect(): Promise<Session> {
  const session = await getSession();
  if (session) {
    return session;
  }
  // Get the current URL from headers for server-side redirect
  const headersList = await headers();
  const pathname = headersList.get("x-pathname") ?? "";
  const searchParams = headersList.get("x-search-params") ?? "";
  const currentUrl = pathname + searchParams;
  const returnUrl = encodeURIComponent(currentUrl);
  redirect(`/signin?returnUrl=${returnUrl}`);
}

/**
 * Verifies that a given user ID matches the currently authenticated user's ID.
 * This is useful for ensuring users can only access their own resources.
 *
 * @param userId - The user ID to verify against the current context
 * @returns Promise resolving to true if the user ID matches, false otherwise
 *
 */
export async function verifyUserId(userId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) {
    console.error("Authentication not found");
    return false;
  }
  if (session.user.id !== userId) {
    console.error(
      `UserId ${userId} does not match session user id ${session.user.id}`,
    );
    return false;
  }
  return true;
}
