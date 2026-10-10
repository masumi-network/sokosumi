import { NextResponse } from "next/server";
import { z } from "zod";
import { readRouteSession } from "@/lib/auth/route-session";
import { buildCoreChatProxyHeaders } from "@/lib/clients/utils/build-core-chat-proxy-headers";
import { getServerCoreApiBaseUrl } from "@/lib/clients/utils/core-api-base-url";

const paramsSchema = z.object({
  projectId: z.string(),
  connectionId: z.uuid(),
});
const exportSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  pages: z.array(z.record(z.string(), z.unknown())).min(1).max(20),
});

/** Core validates and authorizes the loaded sample without another provider read. */
export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; connectionId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (sessionRead.status === "unavailable")
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const params = paramsSchema.safeParse(await context.params);
  if (!params.success)
    return NextResponse.json({ error: "Invalid connection" }, { status: 400 });
  const body = exportSchema.safeParse(await request.json().catch(() => null));
  if (!body.success)
    return NextResponse.json({ error: "Invalid sample" }, { status: 400 });
  const { projectId, connectionId } = params.data;
  const headers = new Headers(buildCoreChatProxyHeaders(request.headers));
  headers.set("content-type", "application/json");
  try {
    const upstream = await fetch(
      `${getServerCoreApiBaseUrl().replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}/social-connections/${encodeURIComponent(connectionId)}/performance/audience/export`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(body.data),
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
          `attachment; filename="audience.${body.data.format}"`,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Export unavailable" }, { status: 503 });
  }
}
