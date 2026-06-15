import type { NextRequest } from "next/server";

import { getSession } from "@/lib/auth/auth.server";

/**
 * Used by the chat client when `useChat` runs stream resume but no real
 * conversation id is available yet. The AI SDK treats HTTP 204 as “no active
 * stream” and does not throw.
 */
export async function GET(_req: NextRequest) {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  return new Response(null, { status: 204 });
}
