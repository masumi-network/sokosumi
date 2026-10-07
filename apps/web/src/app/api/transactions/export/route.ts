import { type NextRequest, NextResponse } from "next/server";

import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/** The only query parameters Core's export route declares. */
const FORWARDED_PARAMS = ["from", "to", "q", "scope", "types", "projectId"];

/**
 * Download the credit ledger as CSV.
 *
 * A same-origin pass-through, like the drive file route: Core builds the file
 * and checks access, web keeps the browser from needing a Core credential.
 * Streamed, so a 70k-row account never sits in this function's memory.
 */
export async function GET(request: NextRequest) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const forwarded = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) forwarded.set(key, value);
  }

  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");

  try {
    const upstream = await fetch(
      `${base}/transactions/export?${forwarded.toString()}`,
      {
        headers: buildCoreChatProxyHeaders(request.headers),
        cache: "no-store",
      },
    );

    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Export failed" },
        {
          status:
            upstream.status === 400 || upstream.status === 422 ? 400 : 502,
        },
      );
    }

    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition":
          upstream.headers.get("content-disposition") ??
          'attachment; filename="transactions.csv"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Failed to stream transactions export", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
