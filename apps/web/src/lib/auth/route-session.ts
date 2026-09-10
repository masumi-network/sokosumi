import "server-only";

import { NextResponse } from "next/server";

import { getSessionResult, type Session } from "./auth.server";
import type { CoreAuthReadErrorReason } from "./core-auth-read-error";

/**
 * What a route handler learned when it read the session.
 *
 * `signedOut` is an answered read carrying no session. `unavailable` is a
 * read that never reached Core — a timeout, a network failure, a body that
 * did not parse, or an unexpected status. Collapsing the two is what told
 * working browsers their session was gone: `getSession()` returns `null` for
 * both, so every route answered 401 for a Core stall.
 */
export type RouteSessionRead =
  | { status: "authenticated"; session: Session }
  | { status: "signedOut" }
  | { status: "unavailable"; reason: CoreAuthReadErrorReason };

/** Come back shortly — the session is fine, Core was only slow. */
const RETRY_AFTER_HEADERS = { "Retry-After": "1" };

export async function readRouteSession(): Promise<RouteSessionRead> {
  const result = await getSessionResult();

  if (result.isErr()) {
    return { status: "unavailable", reason: result.error.reason };
  }

  const session = result.value;
  return session
    ? { status: "authenticated", session }
    : { status: "signedOut" };
}

/**
 * 503 for a session read that could not reach Core. Never 401: that tells the
 * browser to drop what it holds for the signed-in user and, in the realtime
 * client's case, to stop listening for the rest of the page's life.
 */
export function coreSessionUnavailableJson(
  message: string,
  reason: CoreAuthReadErrorReason,
): NextResponse {
  return NextResponse.json(
    { error: message, reason },
    { status: 503, headers: RETRY_AFTER_HEADERS },
  );
}

/** Same answer for the routes that speak plain text (the chat stream proxies). */
export function coreSessionUnavailableText(
  reason: CoreAuthReadErrorReason,
): Response {
  return new Response(`Service Unavailable: ${reason}`, {
    status: 503,
    headers: RETRY_AFTER_HEADERS,
  });
}
