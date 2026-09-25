import { type NextRequest, NextResponse } from "next/server";

import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

/**
 * Serve one image version's bytes to the browser.
 *
 * A same-origin pass-through to Core, which is where the access check lives.
 * Web adds nothing to the decision — it only avoids the browser having to hold
 * a Core credential, and keeps the URL on this origin so `next/image` and
 * `<img>` behave normally.
 *
 * The response is streamed, so a 4K PNG never sits in this function's memory.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string; assetId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const { projectId, assetId } = await params;
  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");

  try {
    const upstream = await fetch(
      `${base}/projects/${projectId}/image-studio/assets/${assetId}/content`,
      {
        headers: buildCoreChatProxyHeaders(request.headers),
        cache: "no-store",
      },
    );
    if (!upstream.ok || !upstream.body) {
      return NextResponse.json(
        { error: "Not found" },
        { status: upstream.status === 401 ? 401 : 404 },
      );
    }
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") ?? "image/png",
        // Mirrors Core's policy rather than inventing a laxer one: the bytes
        // are stable, but permission to read them is not, so every reuse
        // revalidates through the route that checks access.
        "cache-control": "private, no-cache",
        ...(upstream.headers.get("etag")
          ? { etag: upstream.headers.get("etag")! }
          : {}),
      },
    });
  } catch (error) {
    console.error("Failed to stream image studio asset", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
