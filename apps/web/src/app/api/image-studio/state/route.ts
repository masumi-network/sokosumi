import type { NextRequest } from "next/server";

import { imageStudioService } from "@/lib/services/image-studio.service";

import { studioStateResponse } from "../studio-state-response";

/** Polled state for the studio with no project picked: the whole workspace. */
export async function GET(request: NextRequest) {
  return studioStateResponse(request, (query) =>
    imageStudioService.getWorkspaceState(query),
  );
}
