import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import { coworkerService } from "@/lib/services/coworker.service";

/**
 * GET /api/coworkers
 * Returns the list of coworkers for the authenticated user (from Core API / DB).
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const coworkers = await coworkerService.listCoworkers();
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
