import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";
import { socialPerformanceQuerySchema } from "@/lib/social-performance-query";

const querySchema = socialPerformanceQuerySchema.extend({
  projectId: z.uuid().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable")
    return coreSessionUnavailableJson("Performance unavailable", sessionRead);
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { workspaceId } = await params;
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!z.uuid().safeParse(workspaceId).success || !query.success)
    return NextResponse.json(
      { error: "Invalid scope or filters" },
      { status: 400 },
    );
  try {
    const data = await projectService.listWorkspaceSocialPerformance(
      workspaceId,
      {
        ...query.data,
        publishedFrom: query.data.publishedFrom
          ? new Date(query.data.publishedFrom)
          : undefined,
        publishedUntil: query.data.publishedUntil
          ? new Date(query.data.publishedUntil)
          : undefined,
      },
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return NextResponse.json(
      { error: "Performance unavailable" },
      {
        status:
          error instanceof CoreApiRequestError ? (error.status ?? 502) : 502,
      },
    );
  }
}
