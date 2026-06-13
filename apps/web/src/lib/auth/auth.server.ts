import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";

import type { Session } from "@/lib/auth/auth";
import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

export type { Session };

interface GetSessionOptions {
  refresh?: boolean;
}

const CORE_GET_SESSION_PATH = "/auth/get-session";
const CORE_GET_SESSION_TIMEOUT_MS = 5000;

async function fetchSession(
  requestHeaders: Headers,
  options?: GetSessionOptions,
): Promise<Session | null> {
  // Concatenate rather than `new URL(path, base)` so a base URL with a
  // sub-path (e.g. `https://host/core`) is preserved instead of dropped by
  // absolute-path resolution.
  const sessionUrl = new URL(
    joinCoreApiPath(getServerCoreAppBaseUrl(), CORE_GET_SESSION_PATH),
  );

  if (options?.refresh) {
    sessionUrl.searchParams.set("disableCookieCache", "true");
  }

  try {
    const response = await fetch(sessionUrl, {
      headers: buildAuthHeaders(requestHeaders),
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_GET_SESSION_TIMEOUT_MS),
    });

    if (!response.ok) {
      return null;
    }

    const body = (await response.json()) as Session | null;

    if (!body?.session || !body.user) {
      return null;
    }

    return body;
  } catch (error) {
    // Core unreachable, timed out, or returned a non-JSON body. Preserve the
    // null-returning contract callers rely on instead of throwing.
    console.error("Failed to fetch session from Core", error);
    return null;
  }
}

const getCachedSession = cache(async (): Promise<Session | null> => {
  return fetchSession(await headers());
});

/**
 * Gets the current user's session information. This function only works with
 * session-based authentication, not API keys.
 *
 * @returns Promise resolving to the user's session if valid, null otherwise
 */
export async function getSession(
  options?: GetSessionOptions,
): Promise<Session | null> {
  if (options?.refresh) {
    return fetchSession(await headers(), options);
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
