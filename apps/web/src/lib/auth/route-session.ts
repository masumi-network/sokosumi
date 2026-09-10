import "server-only";

import type { Session } from "@sokosumi/utils";
import { NextResponse } from "next/server";

import { getSessionResult } from "./auth.server";
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
  | {
      status: "unavailable";
      reason: CoreAuthReadErrorReason;
      /** The status Core answered with, when it answered at all. */
      httpStatus?: number;
    };

export type RouteSessionUnavailable = Extract<
  RouteSessionRead,
  { status: "unavailable" }
>;

/** Come back shortly — the session is fine, Core was only slow. */
const RETRY_AFTER_HEADERS = { "Retry-After": "1" };

/**
 * A Core auth status that no amount of waiting clears: Better Auth's
 * trusted-origin check, a WAF rule on the web-to-Core hop, or a route that is
 * gone. These are not a logout, so they still read as unavailable, but telling
 * the browser to retry in a second would have it hammer a misconfiguration
 * until someone notices.
 */
const PERMANENT_CORE_AUTH_STATUSES = [403, 404];

function isRetriable(read: RouteSessionUnavailable): boolean {
  return (
    read.httpStatus === undefined ||
    !PERMANENT_CORE_AUTH_STATUSES.includes(read.httpStatus)
  );
}

export async function readRouteSession(): Promise<RouteSessionRead> {
  const result = await getSessionResult();

  if (result.isErr()) {
    return {
      status: "unavailable",
      reason: result.error.reason,
      httpStatus: result.error.status,
    };
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
  read: RouteSessionUnavailable,
): NextResponse {
  return isRetriable(read)
    ? NextResponse.json(
        { error: message, reason: read.reason },
        { status: 503, headers: RETRY_AFTER_HEADERS },
      )
    : NextResponse.json(
        { error: message, reason: read.reason },
        { status: 502 },
      );
}

/** Same answer for the routes that speak plain text (the chat stream proxies). */
export function coreSessionUnavailableText(
  read: RouteSessionUnavailable,
): Response {
  return isRetriable(read)
    ? new Response(`Service Unavailable: ${read.reason}`, {
        status: 503,
        headers: RETRY_AFTER_HEADERS,
      })
    : new Response(`Bad Gateway: ${read.reason}`, { status: 502 });
}
