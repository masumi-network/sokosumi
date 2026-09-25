import { type NextRequest, NextResponse } from "next/server";

import { readRouteSession } from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.request";
import { imageStudioService } from "@/lib/services/image-studio.service";

/**
 * Polled state for the open studio.
 *
 * A route handler rather than a server action: Next serializes concurrent
 * server actions per session, and a background poll must never delay the
 * person's own click. Core settles finished generations as part of answering
 * this, which is what makes the studio work on a deployment fal cannot call
 * back.
 */
export async function GET(
  _request: NextRequest,
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
    const state = await imageStudioService.getState(projectId);
    return NextResponse.json(state, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    if (error instanceof CoreApiRequestError && error.status === 404) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (error instanceof CoreApiRequestError && error.status === 401) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("Failed to read image studio state", error);
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
}
