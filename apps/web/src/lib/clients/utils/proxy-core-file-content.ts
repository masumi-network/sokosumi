import { type NextRequest, NextResponse } from "next/server";
import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";
/** Session-checked, streaming bytes for canonical Drive and job content routes. */
export async function proxyCoreFileContent(
  request: NextRequest,
  corePath: string,
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");
  try {
    const upstream = await fetch(`${base}${corePath}`, {
      headers: buildCoreChatProxyHeaders(request.headers),
      cache: "no-store",
    });

    if (!upstream.ok || !upstream.body) {
      // 503 passes through as itself: the file is not gone, the store is
      // temporarily unreadable, and a caller should retry. Everything else
      // collapses to 404 rather than describing Core's internals.
      if (upstream.status === 503) {
        return NextResponse.json(
          { error: "Unavailable" },
          { status: 503, headers: { "Retry-After": "30" } },
        );
      }
      return NextResponse.json(
        { error: "Not found" },
        { status: upstream.status === 401 ? 401 : 404 },
      );
    }

    const header = (name: string) => upstream.headers.get(name);
    return new NextResponse(upstream.body, {
      status: 200,
      headers: {
        "content-type": header("content-type") ?? "application/octet-stream",
        // Mirror Core's policy rather than inventing a laxer one: the bytes
        // are stable, permission to read them is not, so every reuse
        // revalidates through the route that checks access.
        "cache-control": "private, no-cache",
        ...(header("etag") ? { etag: header("etag") as string } : {}),
        ...(header("content-length")
          ? { "content-length": header("content-length") as string }
          : {}),
        ...(header("content-disposition")
          ? { "content-disposition": header("content-disposition") as string }
          : {}),
        // Carried through deliberately. These are what keep user-supplied
        // bytes from executing as a same-origin document on *this* origin,
        // which is the one the session cookie belongs to.
        "x-content-type-options": "nosniff",
        "content-security-policy":
          header("content-security-policy") ?? "sandbox; default-src 'none'",
      },
    });
  } catch (error) {
    console.error("Failed to stream file content", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
