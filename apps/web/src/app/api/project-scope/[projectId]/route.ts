import { NextResponse } from "next/server";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";
import { projectService } from "@/lib/services/project.service";

/**
 * SOK-1202 harness: names the scoped project for a switcher trigger. A Route
 * Handler, not a server action, because the chrome reads it on mount and
 * Next serializes server actions per session. Core checks workspace access;
 * a project the reader cannot see is `null`.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("Project unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { projectId } = await params;
  try {
    const project = await projectService.getProjectById(projectId);
    return NextResponse.json(
      {
        project: project
          ? { id: project.id, name: project.name, logo: project.logo }
          : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    // Core rejects an id that is not a uuid (422 from its request
    // validation): no such project, not an outage.
    if (status === 400 || status === 422) {
      return NextResponse.json(
        { project: null },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json({ error: "Project unavailable" }, { status });
  }
}
