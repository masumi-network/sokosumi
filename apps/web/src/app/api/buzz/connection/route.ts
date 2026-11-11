import { NextResponse } from "next/server";

import {
  CoreApiRequestError,
  coreClientNoRedirect,
} from "@/lib/clients/core.client";

/**
 * The caller's Buzz connection, for the sidebar card and the connect dialog's
 * polling: a background read, so it stays out of the server action queue.
 * Core authenticates the caller.
 */
export async function GET() {
  try {
    // Core's own envelope ({ data, meta }), which the client transformer reads.
    const envelope = await coreClientNoRedirect.getBuzzConnection();
    return NextResponse.json(envelope, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Buzz unavailable" }, { status });
  }
}
