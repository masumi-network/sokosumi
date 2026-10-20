import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const querySchema = z.object({
  provider: z
    .enum(["x", "instagram", "facebook", "linkedin", "tiktok", "youtube"])
    .optional(),
  publishedFrom: z.iso.datetime().optional(),
  publishedUntil: z.iso.datetime().optional(),
  cursor: z.string().optional(),
  connectionId: z.uuid().optional(),
});

/**
 * Cached Performance for every connected account in the active workspace.
 *
 * Same-origin pass-through: Core checks workspace access.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable")
    return coreSessionUnavailableJson("Statistics unavailable", sessionRead);
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { workspaceId } = await params;
  const query = querySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success)
    return NextResponse.json({ error: "Invalid filters" }, { status: 400 });

  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(query.data)) {
    if (value) forwarded.set(key, value);
  }

  const base = getServerCoreApiBaseUrl().replace(/\/$/, "");

  try {
    const upstream = await fetch(
      `${base}/workspaces/${encodeURIComponent(workspaceId)}/social-connections/statistics?${forwarded}`,
      {
        headers: buildCoreChatProxyHeaders(request.headers),
        cache: "no-store",
      },
    );
    const body: unknown = await upstream.json().catch(() => null);
    if (!upstream.ok) {
      return NextResponse.json(
        { error: "Statistics unavailable" },
        {
          status:
            upstream.status === 400 ||
            upstream.status === 403 ||
            upstream.status === 422
              ? upstream.status
              : 502,
        },
      );
    }
    if (
      !body ||
      typeof body !== "object" ||
      !("data" in body) ||
      body.data == null
    ) {
      return NextResponse.json(
        { error: "Statistics unavailable" },
        { status: 502 },
      );
    }
    return NextResponse.json(body.data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("Failed to read workspace social statistics", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
