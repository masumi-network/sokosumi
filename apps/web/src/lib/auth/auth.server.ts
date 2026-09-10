import "server-only";

import type { Account, Session } from "@sokosumi/utils";
import { resolveBetterAuthCookiePrefix } from "@sokosumi/utils";
import { getSessionCookie } from "better-auth/cookies";
import { err, ok, type Result } from "neverthrow";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getEnvSecrets } from "@/config/env.secrets";
import { buildAuthHeaders } from "@/lib/clients/core.client";
import { getServerCoreAppBaseUrl } from "@/lib/clients/utils/core-api-base-url";
import { joinCoreApiPath } from "@/lib/clients/utils/core-api-base-url.shared";
import { reportCoreAuthReadOutage } from "@/lib/sentry/core-auth-read-outage";

import type {
  CoreAuthReadError,
  CoreAuthReadErrorReason,
} from "./core-auth-read-error";
import { CoreAuthUnavailableError } from "./errors";

export type { Session };

interface GetSessionOptions {
  refresh?: boolean;
}

export interface OAuthClientPublic {
  client_id?: string;
  client_name?: string;
}

const CORE_GET_SESSION_PATH = "/auth/get-session";
const CORE_LIST_ACCOUNTS_PATH = "/auth/list-accounts";
const CORE_GET_OAUTH_CLIENT_PUBLIC_PATH = "/auth/oauth2/public-client";
// 8s, not 5s. Production Core answers `/auth/get-session` in tens of
// milliseconds; this budget is only spent on a stall (cold start, connection
// storm, a saturated web function). Five seconds turned those stalls into
// "no session". Callers in front of it allow far more: background chat reads
// give the browser 20-30s.
const CORE_AUTH_REQUEST_TIMEOUT_MS = 8000;
/**
 * The one Core auth status that means "this browser has no session". 403 and
 * 404 are deliberately absent: on `/auth/get-session` a 403 is Better Auth's
 * trusted-origin check or a WAF rule on the web-to-Core hop, and a 404 means
 * the route is gone. Reading either as "signed out" would log every user out
 * silently and hide the misconfiguration behind a sign-in page.
 */
const CORE_SIGNED_OUT_STATUSES = [401];

/**
 * Classifies a thrown Core auth read failure.
 *
 * `AbortSignal.timeout` covers the body stream as well as the headers, so a
 * stall part-way through the body surfaces here as a `TimeoutError` from
 * `response.json()`. Keep this the only place that names a reason, or a body
 * read gets filed as a parse fault and the 503 reason lies about the outage.
 */
function classifyCoreAuthReadFailure(error: unknown): CoreAuthReadErrorReason {
  if (!(error instanceof Error)) {
    return "network";
  }
  if (error.name === "TimeoutError") {
    return "timeout";
  }
  if (error instanceof SyntaxError) {
    return "invalid_json";
  }
  return "network";
}

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

    return ok((await response.json()) as T);
  } catch (error) {
    // PPR soft-abort during shell probe — not an auth failure. Rethrow so React
    // / Cache Components can finish the boundary instead of treating this as a
    // Core outage.
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      error.digest === "HANGING_PROMISE_REJECTION"
    ) {
      throw error;
    }

    const reason = classifyCoreAuthReadFailure(error);
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

// Headers-only: connection() is illegal under "use cache: private"
// (next-request-in-use-cache). Keep shared auth reads safe for that boundary.
async function getRequestHeaders(): Promise<Headers> {
  return headers();
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

/**
 * Reads the session from Core, keeping "there is no session" separate from
 * "Core could not be asked".
 *
 * `ok(null)` means the request was answered and carried no session. `err`
 * means a timeout, a network failure, a non-JSON body, or an unexpected HTTP
 * status — an outage, not a signed-out user. Collapsing the two made a five
 * second Core timeout indistinguishable from a logout, so callers answered 401
 * to users whose session was fine.
 */
async function fetchSessionResult(
  requestHeaders: Headers,
  options?: GetSessionOptions,
): Promise<Result<Session | null, CoreAuthReadError>> {
  // Skip Core entirely when the browser did not send a session cookie. Auth
  // entry pages call getSession on every visit; anonymous users were paying a
  // full Core RTT for a guaranteed null.
  if (!hasSessionCookie(requestHeaders)) {
    return ok(null);
  }

  const result = await fetchCoreAuth<Session | null>(
    CORE_GET_SESSION_PATH,
    requestHeaders,
    {
      failureLogMessage: "Failed to fetch session from Core",
      searchParams: {
        disableCookieCache: options?.refresh ? "true" : undefined,
      },
      // Core answers 200 with a null body for a signed-out browser, so these
      // statuses are not expected. Keep them out of Sentry anyway: an auth
      // status is about this request, not about Core being down.
      sentryIgnoreHttpStatuses: [...CORE_SIGNED_OUT_STATUSES, 403, 404],
    },
  );

  return (
    result
      .map((body) => (body?.session && body.user ? body : null))
      // An auth status from Core is this browser's own credentials failing, not
      // Core being unreachable. Reporting it as an outage would answer 503 with
      // `Retry-After` for a condition that never clears, so read it as the
      // signed-out answer it is.
      .orElse((error) =>
        error.reason === "http" &&
        error.status !== undefined &&
        CORE_SIGNED_OUT_STATUSES.includes(error.status)
          ? ok(null)
          : err(error),
      )
  );
}

const getCachedSessionResult = cache(
  async (): Promise<Result<Session | null, CoreAuthReadError>> => {
    return fetchSessionResult(await getRequestHeaders());
  },
);

/**
 * Session read that reports a Core outage instead of hiding it as "no session".
 * Use from route handlers that would otherwise answer 401 for a timeout; an
 * `err` belongs in a 503, never a 401.
 */
export async function getSessionResult(
  options?: GetSessionOptions,
): Promise<Result<Session | null, CoreAuthReadError>> {
  if (options?.refresh) {
    return fetchSessionResult(await getRequestHeaders(), options);
  }

  return getCachedSessionResult();
}

/**
 * Gets the current user's session information. This function only works with
 * session-based authentication, not API keys.
 *
 * @returns Promise resolving to the user's session if valid, null otherwise
 */
export async function getSession(
  options?: GetSessionOptions,
): Promise<Session | null> {
  return (await getSessionResult(options)).unwrapOr(null);
}

const getCachedUserAccounts = cache(
  async (): Promise<Result<Account[], CoreAuthReadError>> => {
    const result = await fetchCoreAuth<unknown>(
      CORE_LIST_ACCOUNTS_PATH,
      await getRequestHeaders(),
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

const getCachedOAuthClientPublic = cache(
  async (
    clientId: string,
  ): Promise<Result<OAuthClientPublic | null, CoreAuthReadError>> => {
    const result = await fetchCoreAuth<OAuthClientPublic | null>(
      CORE_GET_OAUTH_CLIENT_PUBLIC_PATH,
      await getRequestHeaders(),
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
/**
 * `/signin` carrying the page the user was on. Shared with the app-shell gates,
 * which redirect for a signed-out browser but must not for a Core outage.
 */
export async function signInRedirectPath(): Promise<string> {
  const headersList = await getRequestHeaders();
  const pathname = headersList.get("x-pathname") ?? "";
  const searchParams = headersList.get("x-search-params") ?? "";
  return `/signin?returnUrl=${encodeURIComponent(pathname + searchParams)}`;
}

export async function getSessionOrRedirect(): Promise<Session> {
  const result = await getSessionResult();
  // Redirect only for an answered read that carried no session. A Core stall
  // must not send a signed-in user to /signin: it reads as a logout and the
  // error boundary is the honest, retryable answer.
  if (result.isErr()) {
    throw new CoreAuthUnavailableError(result.error.reason);
  }
  const session = result.value;
  if (session) {
    return session;
  }
  redirect(await signInRedirectPath());
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
