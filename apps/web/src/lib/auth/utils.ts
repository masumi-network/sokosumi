import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import { getEnvSecrets } from "@/config/env.secrets";
import { auth, Session } from "@/lib/auth/auth";

/**
 * Gets the current user's session information. This function only works with
 * session-based authentication, not API keys.
 *
 * @returns Promise resolving to the user's session if valid, null otherwise
 *
 */
export const getSession = cache(async (): Promise<Session | null> => {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
});

/**
 * @deprecated Use `getSession()` directly.
 */
export const getAuthContext = cache(async (): Promise<Session | null> => {
  return await getSession();
});

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

/**
 * Authenticates a request using a Bearer token that should match the CRON_SECRET
 * environment variable. This is typically used for internal cron job authentication
 * to ensure only authorized services can trigger scheduled tasks.
 *
 * @param request - The incoming request to authenticate
 * @returns An object indicating authentication success or failure with appropriate response
 *
 */
export function authenticateCronSecret(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  const authHeader = request.headers.get("authorization");
  const cronSecret = getEnvSecrets().CRON_SECRET;
  if (!cronSecret) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ message: "Cron secret not set" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ message: "Invalid cron secret" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }
  return { ok: true };
}
