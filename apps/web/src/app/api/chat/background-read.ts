import { NextResponse } from "next/server";

import { getSessionResult } from "@/lib/auth/auth.server";
import { CoreApiRequestError } from "@/lib/clients/core.request";

interface BackgroundChatReadPage {
  data: unknown;
  /** Present for list reads so the generated transformer shape holds. */
  pagination?: { nextCursor: string | null; limit: number };
}

/**
 * Shared shape of the chat background GET routes (SOK-986): a session
 * check that answers JSON 401 rather than a sign-in redirect, a no-store
 * JSON page with the Core response envelope, and Core failure status passed
 * through without its details. Background reads bypass the server action
 * queue used by chat mutations.
 *
 * A session read that could not reach Core answers 503, never 401. Only an
 * answered read carrying no session is a 401.
 */
export async function respondToBackgroundChatRead(
  unavailableMessage: string,
  read: () => Promise<BackgroundChatReadPage>,
): Promise<NextResponse> {
  try {
    const sessionResult = await getSessionResult();
    // A Core timeout is not a logout. Answering 401 for one told the browser
    // the session was gone; 503 says retry.
    if (sessionResult.isErr()) {
      return NextResponse.json(
        { error: unavailableMessage, reason: sessionResult.error.reason },
        { status: 503, headers: { "Retry-After": "1" } },
      );
    }
    if (!sessionResult.value) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const page = await read();
    return NextResponse.json(
      {
        data: page.data,
        meta: {
          timestamp: new Date(),
          requestId: crypto.randomUUID(),
          ...(page.pagination && {
            pagination: { cursor: null, ...page.pagination },
          }),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    // Core's server client may throw a sign-in redirect. A background read
    // must return a failed response, never sign-in HTML as successful data.
    //
    // A `CoreApiRequestError` with no status never reached Core at all: a
    // timeout or a dropped connection. That is the same retriable stall as the
    // session read above, so it answers 503. An answered failure keeps its own
    // status, and anything else thrown here stays 502.
    const status =
      error instanceof CoreApiRequestError ? error.status || 503 : 502;
    return NextResponse.json({ error: unavailableMessage }, { status });
  }
}
