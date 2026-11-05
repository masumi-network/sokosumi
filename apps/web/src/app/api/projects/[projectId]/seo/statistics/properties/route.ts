import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { seoServiceNoRedirect } from "@/lib/services/seo.service";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const session = await readRouteSession();
  if (session.status === "unavailable")
    return coreSessionUnavailableJson("SEO statistics unavailable", session);
  if (session.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const provider = z
    .enum(["ga4", "search_console"])
    .safeParse(new URL(request.url).searchParams.get("provider"));
  if (!z.uuid().safeParse(projectId).success || !provider.success)
    return NextResponse.json(
      { error: "Invalid statistics provider" },
      { status: 400 },
    );
  try {
    return NextResponse.json(
      await seoServiceNoRedirect.statisticsProperties(projectId, provider.data),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? (error.status ?? 502) : 502;
    return NextResponse.json(
      { error: "SEO statistics unavailable" },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }
}
