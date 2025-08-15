import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getEnvSecrets } from "@/config/env.secrets";
import { auth, Session } from "@/lib/auth/auth";

/**
 * Represents the authentication scope for a user, including their user ID
 * and optional active organization ID.
 */
export interface AuthContext {
  /** The unique identifier of the authenticated user */
  userId: string;
  /** The active organization ID the user belongs to, or null if none is active */
  organizationId: string | null;
}

/**
 * Authenticates a user using an API key and returns their context.
 *
 * @param key - The API key to verify
 * @returns Promise resolving to the user's context if valid, null otherwise
 */
async function getAuthContextFromApiKey(
  key: string,
): Promise<AuthContext | null> {
  const apiKeyResult = await auth.api.verifyApiKey({
    body: {
      key,
    },
  });
  if (!apiKeyResult.valid || !apiKeyResult.key) {
    return null;
  }
  return {
    userId: apiKeyResult.key.userId,
    organizationId: apiKeyResult.key.metadata?.organizationId ?? null,
  };
}

/**
 * Authenticates a user using their session and returns their context.
 *
 * @param headers - The request headers containing session information
 * @returns Promise resolving to the user's context if valid, null otherwise
 */
async function getAuthContextFromSession(
  headers: Headers,
): Promise<AuthContext | null> {
  const session = await auth.api.getSession({
    headers,
  });
  if (!session) {
    return null;
  }
  return {
    userId: session.user.id,
    organizationId: session.session.activeOrganizationId ?? null,
  };
}

// ============================================================================
// AUTH CONTEXT FUNCTIONS
// ============================================================================

/**
 * Gets the current user's authentication context by checking for either an API key
 * or session. This function automatically determines the authentication method
 * based on the presence of an 'x-api-key' header.
 *
 * @returns Promise resolving to the user's context if authenticated, null otherwise
 *
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const headersList = await headers();
  const key = headersList.get("x-api-key");
  if (key) {
    return await getAuthContextFromApiKey(key);
  } else {
    return await getAuthContextFromSession(headersList);
  }
}

// ============================================================================
// SESSION FUNCTIONS
// ============================================================================

/**
 * Gets the current user's session information. This function only works with
 * session-based authentication, not API keys.
 *
 * @returns Promise resolving to the user's session if valid, null otherwise
 *
 */
export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
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
  redirect(`/login?returnUrl=${returnUrl}`);
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
  const context = await getAuthContext();
  if (!context) {
    console.error("Authentication not found");
    return false;
  }
  if (context.userId !== userId) {
    console.error(
      `UserId ${userId} does not match context user id ${context.userId}`,
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
