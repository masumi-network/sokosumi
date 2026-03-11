import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { coworkerService } from "@/lib/services/coworker.service";

const VALID_CAPABILITIES = ["chat", "tasks"] as const;

/**
 * GET /api/coworkers
 * Returns the list of coworkers for the authenticated user (from Core API / DB).
 * Optional query: capability=chat|tasks to return only coworkers with that capability.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401 },
    );
  }

  const url = new URL(request.url);
  const capabilityParam = url.searchParams.get("capability");
  const capability =
    capabilityParam && VALID_CAPABILITIES.includes(capabilityParam)
      ? (capabilityParam as (typeof VALID_CAPABILITIES)[number])
      : undefined;

  try {
    const coworkers = await coworkerService.listCoworkers({
      ...(capability && { capability }),
    });
    return NextResponse.json({ data: coworkers });
  } catch (error) {
    console.error("Failed to fetch coworkers:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message:
          error instanceof Error ? error.message : "Failed to fetch coworkers",
      },
      { status: 500 },
    );
  }
}
