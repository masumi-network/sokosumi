import "server-only";

import type { Account, Session } from "@sokosumi/utils";
import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";
import { err, ok, type Result } from "neverthrow";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { ActiveSubscription } from "@/components/billing/subscription-plan-utils";
import { getEnvSecrets } from "@/config/env.secrets";
import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";
import { reportCoreAuthReadOutage } from "@/lib/sentry/core-auth-read-outage";

import type {
  CoreAuthReadError,
  CoreAuthReadErrorReason,
} from "./core-auth-read-error";

export type { Session };

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
    sentryIgnoreHttpStatuses?: number[];
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
      const failureLogMessage =
        options?.failureLogMessage ?? "Failed to fetch from Core auth";
      const authReadError: CoreAuthReadError = {
        path,
        reason: "http",
        status: response.status,
      };

      // An expected status (e.g. OAuth-client 404 → "not found") is routine,
      // not an outage: log it at warn and skip the Sentry report so it does
      // not pollute error logs or alerting.
      const isIgnoredStatus =
        options?.sentryIgnoreHttpStatuses?.includes(response.status) ?? false;
      const logFailure = isIgnoredStatus ? console.warn : console.error;

      logFailure(failureLogMessage, {
        path,
        status: response.status,
      });

      if (!isIgnoredStatus) {
        reportCoreAuthReadOutage(authReadError, failureLogMessage);
      }

      return err(authReadError);
    }

    try {
      return ok((await response.json()) as T);
    } catch (error) {
      const failureLogMessage =
        options?.failureLogMessage ?? "Failed to parse Core auth response";
      const authReadError: CoreAuthReadError = {
        path,
        reason: "invalid_json",
      };

      console.error(failureLogMessage, { path, error });
      reportCoreAuthReadOutage(authReadError, failureLogMessage);

      return err(authReadError);
    }
  } catch (error) {
    const reason: CoreAuthReadErrorReason =
      error instanceof Error && error.name === "TimeoutError"
        ? "timeout"
        : "network";
    const failureLogMessage =
      options?.failureLogMessage ?? "Failed to fetch from Core auth";
    const authReadError: CoreAuthReadError = {
      path,
      reason,
    };

    console.error(failureLogMessage, { path, reason, error });
    reportCoreAuthReadOutage(authReadError, failureLogMessage);

    return err(authReadError);
  }
}

function parseCoreAuthArrayResponse<T>(
  path: string,
  failureLogMessage: string,
  result: Result<unknown, CoreAuthReadError>,
): Result<T[], CoreAuthReadError> {
  return result.andThen((body) => {
    if (!Array.isArray(body)) {
      const authReadError: CoreAuthReadError = {
        path,
        reason: "invalid_json",
      };
      const shapeFailureMessage = `${failureLogMessage}: response was not an array`;

      console.error(shapeFailureMessage, { path, bodyType: typeof body });
      reportCoreAuthReadOutage(authReadError, shapeFailureMessage);

      return err(authReadError);
    }

    return ok(body as T[]);
  });
}

function getBetterAuthCookiePrefixFromEnv(): string {
  const env = getEnvSecrets();
  return resolveBetterAuthCookiePrefix({
    network: env.NETWORK,
    vercelEnv: env.VERCEL_ENV,
    vercelGitCommitRef: env.VERCEL_GIT_COMMIT_REF,
  });
}

/**
 * Cheap presence check — no Core round-trip. Anonymous auth entry paths
 * (signin/signup) must not pay Core RTT when no session cookie exists.
 */
function hasSessionCookie(requestHeaders: Headers): boolean {
  return (
    getSessionCookie(requestHeaders, {
      cookiePrefix: getBetterAuthCookiePrefixFromEnv(),
    }) != null
  );
}

async function fetchSession(
  requestHeaders: Headers,
  options?: GetSessionOptions,
): Promise<Session | null> {
  // Skip Core entirely when the browser did not send a session cookie. Auth
  // entry pages call getSession on every visit; anonymous users were paying a
  // full Core RTT for a guaranteed null.
  if (!hasSessionCookie(requestHeaders)) {
    return null;
  }

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
    const result = await fetchCoreAuth<unknown>(
      CORE_LIST_ACCOUNTS_PATH,
      await headers(),
      {
        failureLogMessage: "Failed to fetch user accounts from Core",
      },
    );

    return parseCoreAuthArrayResponse<Account>(
      CORE_LIST_ACCOUNTS_PATH,
      "Failed to fetch user accounts from Core",
      result,
    );
  },
);

/**
 * Lists accounts linked to the current user via Core Better Auth.
 *
 * Core (`GET /auth/list-accounts`) always responds with a JSON array on 200 —
 * empty means `[]`, not `null`. A non-array 200 body is treated as
 * `invalid_json`. Auth failures are non-ok HTTP responses.
 */
export async function listUserAccounts(): Promise<
  Result<Account[], CoreAuthReadError>
> {
  return getCachedUserAccounts();
}

// Keyed on primitive args so React `cache` dedupes across call sites that pass
// equivalent options as separate object literals.
const getCachedActiveSubscriptions = cache(
  async (
    customerType?: "organization" | "user",
    referenceId?: string,
  ): Promise<Result<ActiveSubscription[], CoreAuthReadError>> => {
    const result = await fetchCoreAuth<unknown>(
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

    return parseCoreAuthArrayResponse<ActiveSubscription>(
      CORE_LIST_ACTIVE_SUBSCRIPTIONS_PATH,
      "Failed to fetch active subscriptions from Core",
      result,
    );
  },
);

/**
 * Lists active Stripe-backed subscriptions for the current user or organization.
 *
 * Core (`GET /auth/subscription/list`) always responds with a JSON array on 200 —
 * empty means `[]`, not `null`. A non-array 200 body is treated as
 * `invalid_json`. Auth failures are non-ok HTTP responses.
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
    const result = await fetchCoreAuth<OAuthClientPublic | null>(
      CORE_GET_OAUTH_CLIENT_PUBLIC_PATH,
      await headers(),
      {
        failureLogMessage: "Failed to fetch OAuth client from Core",
        searchParams: { client_id: clientId },
        sentryIgnoreHttpStatuses: [404],
      },
    );

    if (
      result.isErr() &&
      result.error.reason === "http" &&
      result.error.status === 404
    ) {
      return ok(null);
    }

    return result;
  },
);

/**
 * Fetches public OAuth client metadata for the consent screen.
 *
 * Core (`GET /auth/oauth2/public-client`) returns client JSON on 200. A missing
 * or disabled client is HTTP 404, mapped to `ok(null)` — distinct from outages.
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
