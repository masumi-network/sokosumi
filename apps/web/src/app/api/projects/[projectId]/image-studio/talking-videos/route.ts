import { NextResponse } from "next/server";

import { readRouteSession } from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { imageStudioService } from "@/lib/services/image-studio.service";

/**
 * Polled talking videos of one project. A route handler like the studio
 * state: a background poll must never queue behind the person's own click.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (sessionRead.status === "unavailable") {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 503, headers: { "Retry-After": "1" } },
    );
  }
  const { projectId } = await params;
  try {
    return NextResponse.json(
      await imageStudioService.getTalkingVideos(projectId),
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof CoreApiRequestError && error.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to read talking videos", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
