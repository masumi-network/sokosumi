import { NextResponse } from "next/server";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";
import { socialPerformanceQuerySchema } from "@/lib/social-performance-query";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable")
    return coreSessionUnavailableJson("Performance unavailable", sessionRead);
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const query = socialPerformanceQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  const { projectId } = await params;
  try {
    const data = await projectService.listSocialPerformance(projectId, {
      ...query.data,
      publishedFrom: query.data.publishedFrom
        ? new Date(query.data.publishedFrom)
        : undefined,
      publishedUntil: query.data.publishedUntil
        ? new Date(query.data.publishedUntil)
        : undefined,
    });
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? (error.status ?? 502) : 502;
    return NextResponse.json({ error: "Performance unavailable" }, { status });
  }
}
