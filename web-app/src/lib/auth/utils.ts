import "server-only";

import { headers } from "next/headers";

import { getEnvSecrets } from "@/config/env.secrets";
import { compareApiKeys } from "@/lib/api/utils";
import { auth, Session } from "@/lib/auth/auth";

import { UnAuthenticatedError } from "./errors";

export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}

export async function getSessionOrThrow(): Promise<Session> {
  const session = await getSession();
  if (!session) {
    // Get the current URL from headers for server-side redirect
    const headersList = await headers();
    const pathname = headersList.get("x-pathname") ?? "";
    const searchParams = headersList.get("x-search-params") ?? "";
    const currentUrl = pathname + searchParams;

    throw new UnAuthenticatedError(currentUrl);
  }
  return session;
}

export async function verifyUserId(userId: string): Promise<void> {
  const session = await getSessionOrThrow();
  if (session.user.id !== userId) {
    console.error(
      `UserId ${userId} does not match session user id ${session.user.id}`,
    );
    throw new Error("UserId does not match session user id");
  }
}

export async function getActiveOrganizationId(): Promise<
  string | null | undefined
> {
  const session = await getSession();
  return session?.session.activeOrganizationId;
}

/**
 * Checks the admin-api-key header for a valid admin API key.
 * Returns { ok: true } if valid, or { ok: false, response } if not.
 */
export function authenticateAdminApiKey(
  request: Request,
): { ok: true } | { ok: false; response: Response } {
  const headerApiKey = request.headers.get("admin-api-key");
  if (!headerApiKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ message: "No admin api key provided" }),
        { status: 401, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  if (compareApiKeys(headerApiKey) !== true) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ message: "Invalid admin api key" }),
        {
          status: 401,
          headers: { "Content-Type": "application/json" },
        },
      ),
    };
  }
  return { ok: true };
}

/**
 * Checks the Authorization header for a valid Bearer CRON_SECRET.
 * Returns { ok: true } if valid, or { ok: false, response } if not.
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

/**
 * Authenticates an API route request using either the admin-api-key header or a Bearer token (CRON_SECRET).
 * Returns an object indicating the authentication result and type.
 * Usage: Call at the top of your route handler and handle the result accordingly.
 */
export function authenticateApiRequest(
  request: Request,
): { ok: true; type: "admin" | "cron" } | { ok: false; response: Response } {
  const adminResult = authenticateAdminApiKey(request);
  if (adminResult.ok) return { ok: true, type: "admin" };
  const cronResult = authenticateCronSecret(request);
  if (cronResult.ok) return { ok: true, type: "cron" };

  // Determine which authentication method was attempted
  const hasAdminKey = !!request.headers.get("admin-api-key");
  const hasAuthHeader = !!request.headers.get("authorization");

  if (hasAdminKey) return adminResult;
  if (hasAuthHeader) return cronResult;
  // If neither header is present, default to admin error for backward compatibility
  return adminResult;
}
