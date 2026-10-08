import { NextResponse } from "next/server";
import { z } from "zod";
import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";

const querySchema = z.object({
  provider: z
    .enum(["x", "instagram", "facebook", "linkedin", "tiktok", "youtube"])
    .optional(),
  publishedFrom: z.iso.datetime().optional(),
  publishedUntil: z.iso.datetime().optional(),
  cursor: z.string().optional(),
});

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable")
    return coreSessionUnavailableJson("Statistics unavailable", sessionRead);
  if (sessionRead.status === "signedOut")
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { projectId } = await params;
  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success)
    return NextResponse.json({ error: "Invalid filters" }, { status: 400 });
  try {
    const data = await projectService.listSocialPostStatistics(
      projectId,
      query.data,
    );
    return NextResponse.json(data, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError ? (error.status ?? 502) : 502;
    return NextResponse.json({ error: "Statistics unavailable" }, { status });
  }
}
