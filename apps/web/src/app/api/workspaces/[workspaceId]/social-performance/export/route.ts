import { NextResponse } from "next/server";
import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const FORWARDED_PARAMS = [
  "projectId",
  "provider",
  "connectionId",
  "publishedFrom",
  "publishedUntil",
  "timezone",
  "search",
  "contentType",
  "postKind",
  "sort",
  "format",
];

/** Core authorizes the active workspace and exports the full attributed cohort. */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRead.status === "unavailable")
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const { workspaceId } = await params;
  const query = new URLSearchParams();
  const incoming = new URL(request.url).searchParams;
  for (const key of FORWARDED_PARAMS) {
    const value = incoming.get(key);
    if (value) query.set(key, value);
  }
  try {
    const upstream = await fetch(
      `${getServerCoreApiBaseUrl().replace(/\/$/, "")}/workspaces/${encodeURIComponent(workspaceId)}/social-performance/export?${query}`,
      {
        headers: buildCoreChatProxyHeaders(request.headers),
        cache: "no-store",
      },
    );
    if (!upstream.ok || !upstream.body)
      return NextResponse.json(
        { error: "Export failed" },
        {
          status:
            upstream.status >= 400 && upstream.status < 500
              ? upstream.status
              : 502,
        },
      );
    return new NextResponse(upstream.body, {
      headers: {
        "content-type":
          upstream.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition":
          upstream.headers.get("content-disposition") ??
          'attachment; filename="workspace-performance.csv"',
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export unavailable" }, { status: 503 });
  }
}
