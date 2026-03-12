import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth/utils";
import {
  type CoworkerCapability,
  coworkerService,
} from "@/lib/services/coworker.service";

/**
 * GET /api/coworkers
 * Returns the list of coworkers for the authenticated user (from Core API / DB).
 */
const COWORKER_CAPABILITIES = ["chat", "tasks"] as const;

function parseCapability(value: string | null): CoworkerCapability | undefined {
  if (!value) {
    return undefined;
  }

  if (
    COWORKER_CAPABILITIES.includes(
      value as (typeof COWORKER_CAPABILITIES)[number],
    )
  ) {
    return value as CoworkerCapability;
  }

  throw new Error(`Unsupported capability: ${value}`);
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "Unauthorized", message: "Authentication required" },
      { status: 401 },
    );
  }

  try {
    const capability = parseCapability(
      request.nextUrl.searchParams.get("capability"),
    );
    const coworkers = await coworkerService.listCoworkers(capability);
    return NextResponse.json({ data: coworkers });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Unsupported capability:")
    ) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: error.message,
        },
        { status: 400 },
      );
    }

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
