import { NextResponse } from "next/server";

import {
  coreSessionUnavailableJson,
  readRouteSession,
} from "@/lib/auth/route-session";
import { CoreApiRequestError } from "@/lib/clients/core.client";

/**
 * A switcher list read for a Route Handler: server actions run one at a time
 * per session, so the page and Pinned reads queued behind each other. The
 * reply names the workspace it was read in, so the browser can drop rows
 * from a workspace it has already left.
 */
export async function readScopeList<T>(
  read: () => Promise<T>,
): Promise<NextResponse> {
  const sessionRead = await readRouteSession();
  if (sessionRead.status === "unavailable") {
    return coreSessionUnavailableJson("Projects unavailable", sessionRead);
  }
  if (sessionRead.status === "signedOut") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { session } = sessionRead;
  try {
    return NextResponse.json(
      {
        scope: {
          userId: session.user.id,
          organizationId: session.session.activeOrganizationId ?? null,
        },
        data: await read(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const status =
      error instanceof CoreApiRequestError && error.status ? error.status : 502;
    return NextResponse.json({ error: "Projects unavailable" }, { status });
  }
}
