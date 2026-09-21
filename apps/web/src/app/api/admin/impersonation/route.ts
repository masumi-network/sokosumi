import { err, ok } from "neverthrow";
import { type NextRequest, NextResponse } from "next/server";

import { toActionResult } from "@/lib/actions/action-result";
import type { ActionError } from "@/lib/actions/errors/action-error";
import { CommonErrorCode } from "@/lib/actions/errors/error-codes/common";
import type { ImpersonationResult } from "@/lib/api/admin-impersonation";
import { assertAdminSession } from "@/lib/auth/admin-access";
import { isAdminAccessRequiredError } from "@/lib/auth/errors";
import {
  type RouteSessionRead,
  readRouteSession,
} from "@/lib/auth/route-session";
import { coreClientNoRedirect } from "@/lib/clients/core.client";
import {
  CoreApiRequestError,
  toCoreApiActionError,
} from "@/lib/clients/core.request";
import { collectResponseSetCookies } from "@/lib/http/set-cookies";

/**
 * Fetch-metadata guard: only same-origin `fetch()` calls reach the session
 * switch. Browsers send truthful `Sec-Fetch-Site` (cross-site fetch reads
 * `cross-site`), so this rejects CSRF without tokens. Unlike the billing
 * navigation guard, `same-site` and `none` are rejected: the only client is
 * this app's own relative `fetch()`, which always reads `same-origin`.
 */
const ALLOWED_SEC_FETCH_SITE_VALUES = new Set(["same-origin"]);

function isSameOriginFetch(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("Sec-Fetch-Site");
  return (
    secFetchSite !== null && ALLOWED_SEC_FETCH_SITE_VALUES.has(secFetchSite)
  );
}

function resultResponse(
  result: ImpersonationResult,
  status: number,
  setCookies: string[] = [],
  retryAfter = false,
): NextResponse {
  const response = NextResponse.json(result, { status });
  for (const cookie of setCookies) {
    response.headers.append("set-cookie", cookie);
  }
  if (retryAfter) {
    response.headers.set("Retry-After", "1");
  }
  return response;
}

function errorResult(error: ActionError): ImpersonationResult {
  return toActionResult(err(error));
}

async function signedInSessionOrResponse(): Promise<
  | {
      session: Extract<
        RouteSessionRead,
        { status: "authenticated" }
      >["session"];
    }
  | { response: NextResponse }
> {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    // "Core could not be asked" is not "the user is signed out": 503 with a
    // retry hint, never a 401-shaped logout. The DTO shape stays uniform so
    // the caller has one contract.
    return {
      response: resultResponse(
        errorResult({
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: "The service is currently unavailable.",
        }),
        503,
        [],
        true,
      ),
    };
  }
  if (sessionRead.status === "signedOut") {
    return {
      response: resultResponse(
        errorResult({ code: CommonErrorCode.UNAUTHENTICATED }),
        401,
      ),
    };
  }
  return { session: sessionRead.session };
}

/**
 * Maps a Core failure onto an HTTP status. A status Core answered with is
 * proxied so the browser sees the real outcome; a status-less failure never
 * reached Core and stays retryable (503), never a 401-shaped logout.
 */
function coreErrorResponse(error: CoreApiRequestError): NextResponse {
  const dto = toActionResult(err(toCoreApiActionError(error)));
  if (!error.status) {
    return resultResponse(dto, 503, [], true);
  }
  return resultResponse(dto, error.status);
}

interface StartImpersonationBody {
  userId?: unknown;
  reason?: unknown;
}

function readStartBody(body: StartImpersonationBody):
  | ImpersonationResult
  | {
      userId: string;
      reason: string;
    } {
  const userId = typeof body.userId === "string" ? body.userId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (!userId) {
    return errorResult({
      code: CommonErrorCode.BAD_INPUT,
      message: "User id is required",
    });
  }
  if (!reason) {
    return errorResult({
      code: CommonErrorCode.BAD_INPUT,
      message: "Reason is required",
    });
  }
  return { userId, reason };
}

/**
 * Start impersonating a non-admin user (admin only). Switches the browser
 * session to the target via Core's Set-Cookie headers, forwarded VERBATIM:
 * signed values break if parsed and re-serialized (SOK-1080).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginFetch(request)) {
    return resultResponse(
      errorResult({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Cross-site requests are not allowed",
      }),
      403,
    );
  }

  const signedIn = await signedInSessionOrResponse();
  if ("response" in signedIn) {
    return signedIn.response;
  }
  const { session } = signedIn;

  // Conflict before the admin check, mirroring Core: an impersonated caller
  // holds the target's non-admin role, so the admin assertion alone would
  // mislabel this state as unauthorized.
  if (session.session.impersonatedBy) {
    return resultResponse(
      errorResult({
        code: CommonErrorCode.BAD_INPUT,
        message:
          "Already impersonating a user. Stop the current impersonation first.",
      }),
      409,
    );
  }
  try {
    assertAdminSession(session);
  } catch (error) {
    if (!isAdminAccessRequiredError(error)) {
      throw error;
    }
    return resultResponse(
      errorResult({
        code: CommonErrorCode.UNAUTHORIZED,
        message: error.message,
      }),
      403,
    );
  }

  let body: StartImpersonationBody;
  try {
    body = (await request.json()) as StartImpersonationBody;
  } catch {
    return resultResponse(
      errorResult({
        code: CommonErrorCode.BAD_INPUT,
        message: "Invalid JSON",
      }),
      400,
    );
  }
  const params = readStartBody(body ?? {});
  if ("ok" in params) {
    return resultResponse(params, 400);
  }

  try {
    const { data, response } =
      await coreClientNoRedirect.startAdminImpersonation({
        userId: params.userId,
        reason: params.reason,
      });
    const setCookies = collectResponseSetCookies(response);
    if (setCookies.length === 0) {
      return resultResponse(
        errorResult({
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: "Impersonation did not return a session",
        }),
        502,
      );
    }
    return resultResponse(toActionResult(ok(data.data)), 201, setCookies);
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      return coreErrorResponse(error);
    }
    console.error("Failed to start impersonation via Core:", error);
    return resultResponse(
      errorResult({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }),
      500,
    );
  }
}

/**
 * Stop impersonating and restore the admin session. No admin assertion: while
 * impersonating, the caller holds the target's non-admin role. Core rejects
 * the stop when no impersonation is active.
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  if (!isSameOriginFetch(request)) {
    return resultResponse(
      errorResult({
        code: CommonErrorCode.UNAUTHORIZED,
        message: "Cross-site requests are not allowed",
      }),
      403,
    );
  }

  const signedIn = await signedInSessionOrResponse();
  if ("response" in signedIn) {
    return signedIn.response;
  }

  try {
    const { data, response } =
      await coreClientNoRedirect.stopAdminImpersonation();
    const setCookies = collectResponseSetCookies(response);
    if (setCookies.length === 0) {
      return resultResponse(
        errorResult({
          code: CommonErrorCode.INTERNAL_SERVER_ERROR,
          message: "Impersonation did not return a session",
        }),
        502,
      );
    }
    return resultResponse(toActionResult(ok(data.data)), 200, setCookies);
  } catch (error) {
    if (error instanceof CoreApiRequestError) {
      return coreErrorResponse(error);
    }
    console.error("Failed to stop impersonation via Core:", error);
    return resultResponse(
      errorResult({ code: CommonErrorCode.INTERNAL_SERVER_ERROR }),
      500,
    );
  }
}
