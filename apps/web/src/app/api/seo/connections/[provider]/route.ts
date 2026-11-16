import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { requireMatchingSeoViewer } from "@/lib/seo/read-response";
import { seoConnectionService } from "@/lib/services/seo-connection.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
) {
  const session = await readRouteSession();
  if (session.status === "unavailable")
    return coreSessionUnavailableJson("SEO connection unavailable", session);
  if (session.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const provider = z
    .enum(["ga4", "search_console"])
    .safeParse((await params).provider);
  if (!provider.success)
    return NextResponse.json(
      { error: "Invalid statistics provider" },
      { status: 400 },
    );
  try {
    requireMatchingSeoViewer(
      request,
      session.session.user.id,
      session.session.session.activeOrganizationId,
    );
    return NextResponse.json(await seoConnectionService.get(provider.data), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? (error.status ?? 502) : 502;
    return NextResponse.json(
      { error: "SEO connection unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
