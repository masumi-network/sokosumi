import { type NextRequest, NextResponse } from "next/server";

import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const FORWARDED_PARAMS = [
  "provider",
  "connectionId",
  "publishedFrom",
  "publishedUntil",
  "format",
];

/**
 * Download the filtered workspace Performance post table.
 *
 * Same-origin pass-through: Core builds the file and checks access.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const { workspaceId } = await params;
  const forwarded = new URLSearchParams();
  for (const key of FORWARDED_PARAMS) {
    const value = request.nextUrl.searchParams.get(key);
    if (value) forwarded.set(key, value);
  }

  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");

  try {
    const upstream = await fetch(
      `${base}/workspaces/${encodeURIComponent(workspaceId)}/social-connections/statistics/export?${forwarded}`,
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
        "content-type":
          upstream.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "content-disposition":
          upstream.headers.get("content-disposition") ??
          'attachment; filename="performance.csv"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Failed to stream workspace social statistics export", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
