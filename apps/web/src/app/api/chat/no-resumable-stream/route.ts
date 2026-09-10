import type { NextRequest } from "next/server";

import {
  coreSessionUnavailableText,
  readRouteSession,
} from "@/lib/auth/route-session";

/**
 * Used by the chat client when `useChat` runs stream resume but no real
 * conversation id is available yet. The AI SDK treats HTTP 204 as “no active
 * stream” and does not throw.
 */
export async function GET(_req: NextRequest) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableText(sessionRead.reason);
  }
  if (sessionRead.status === "signedOut") {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response(null, { status: 204 });
}
