import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { getEnvSecrets } from "@/config/env.secrets";
import { auth, Session } from "@/lib/auth/auth";

import { UnAuthenticatedError } from "./errors";

export async function getSession(): Promise<Session | null> {
  const session = await auth.api.getSession({
    headers: await headers(),
  });

  return session;
}

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

export async function verifyUserId(userId: string): Promise<boolean> {
  const session = await getSession();
  if (!session) {
    console.error("Session not found");
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
