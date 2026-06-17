import "server-only";

import type { Account, Session } from "@sokosumi/utils";
import { err, ok, type Result } from "neverthrow";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ActiveSubscription } from "@/components/billing/subscription-plan-utils";
import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";

export type { Session };

export type CoreAuthReadErrorReason =
  | "http"
  | "invalid_json"
  | "network"
  | "timeout";

export interface CoreAuthReadError {
  path: string;
  reason: CoreAuthReadErrorReason;
  status?: number;
}

interface GetSessionOptions {
  refresh?: boolean;
}

interface ListActiveSubscriptionsOptions {
  customerType?: "organization" | "user";
  referenceId?: string;
}

export interface OAuthClientPublic {
  client_id?: string;
  client_name?: string;
}

const CORE_GET_SESSION_PATH = "/auth/get-session";
const CORE_LIST_ACCOUNTS_PATH = "/auth/list-accounts";
const CORE_LIST_ACTIVE_SUBSCRIPTIONS_PATH = "/auth/subscription/list";
const CORE_GET_OAUTH_CLIENT_PUBLIC_PATH = "/auth/oauth2/public-client";
const CORE_AUTH_REQUEST_TIMEOUT_MS = 5000;

async function fetchCoreAuth<T>(
  path: string,
  requestHeaders: Headers,
  options?: {
    failureLogMessage?: string;
    searchParams?: Record<string, string | undefined>;
  },
): Promise<Result<T, CoreAuthReadError>> {
  const url = new URL(joinCoreApiPath(getServerCoreAppBaseUrl(), path));

  for (const [key, value] of Object.entries(options?.searchParams ?? {})) {
    if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }

  try {
    const response = await fetch(url, {
      headers: buildAuthHeaders(requestHeaders),
      cache: "no-store",
      signal: AbortSignal.timeout(CORE_AUTH_REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      console.error(
        options?.failureLogMessage ?? "Failed to fetch from Core auth",
        { path, status: response.status },
      );
      return err({
        path,
        reason: "http",
        status: response.status,
      });
    }

    try {
      return ok((await response.json()) as T);
    } catch (error) {
      console.error(
        options?.failureLogMessage ?? "Failed to parse Core auth response",
        { path, error },
      );
      return err({
        path,
        reason: "invalid_json",
      });
    }
  } catch (error) {
    const reason: CoreAuthReadErrorReason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "network";
    console.error(
      options?.failureLogMessage ?? "Failed to fetch from Core auth",
      { path, reason, error },
    );
    return err({
      path,
      reason,
    });
  }
}

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
      signal: AbortSignal.timeout(CORE_AUTH_REQUEST_TIMEOUT_MS),
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

const getCachedUserAccounts = cache(
  async (): Promise<Result<Account[], CoreAuthReadError>> => {
    const result = await fetchCoreAuth<Account[] | null>(
      CORE_LIST_ACCOUNTS_PATH,
      await headers(),
      {
        failureLogMessage: "Failed to fetch user accounts from Core",
      },
    );

    return result.map((accounts) => accounts ?? []);
  },
);

/**
 * Lists accounts linked to the current user via Core Better Auth.
 */
export async function listUserAccounts(): Promise<
  Result<Account[], CoreAuthReadError>
> {
  return getCachedUserAccounts();
}

const getCachedActiveSubscriptions = cache(
  async (
    customerType?: "organization" | "user",
    referenceId?: string,
  ): Promise<Result<ActiveSubscription[], CoreAuthReadError>> => {
    const result = await fetchCoreAuth<ActiveSubscription[] | null>(
      CORE_LIST_ACTIVE_SUBSCRIPTIONS_PATH,
      await headers(),
      {
        failureLogMessage: "Failed to fetch active subscriptions from Core",
        searchParams: {
          customerType,
          referenceId,
        },
      },
    );

    return result.map((subscriptions) => subscriptions ?? []);
  },
);

/**
 * Lists active Stripe-backed subscriptions for the current user or organization.
 */
export async function listActiveSubscriptions(
  options?: ListActiveSubscriptionsOptions,
): Promise<Result<ActiveSubscription[], CoreAuthReadError>> {
  return getCachedActiveSubscriptions(
    options?.customerType,
    options?.referenceId,
  );
}

const getCachedOAuthClientPublic = cache(
  async (
    clientId: string,
  ): Promise<Result<OAuthClientPublic | null, CoreAuthReadError>> => {
    return fetchCoreAuth<OAuthClientPublic | null>(
      CORE_GET_OAUTH_CLIENT_PUBLIC_PATH,
      await headers(),
      {
        failureLogMessage: "Failed to fetch OAuth client from Core",
        searchParams: { client_id: clientId },
      },
    );
  },
);

/**
 * Fetches public OAuth client metadata for the consent screen.
 */
export async function getOAuthClientPublic(
  clientId: string,
): Promise<Result<OAuthClientPublic | null, CoreAuthReadError>> {
  return getCachedOAuthClientPublic(clientId);
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
