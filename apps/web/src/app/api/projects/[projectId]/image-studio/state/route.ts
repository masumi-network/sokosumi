import type { NextRequest } from "next/server";
import { imageStudioService } from "@/lib/services/image-studio.service";
import { studioStateResponse } from "../../../../image-studio/studio-state-response";

/** Polled state for the studio open on one project. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  return studioStateResponse(request, (query) =>
    imageStudioService.getState(projectId, query),
  );
}
