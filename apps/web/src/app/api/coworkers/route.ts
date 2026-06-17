import { type NextRequest, NextResponse } from "next/server";

import type { CoworkerCapability } from "@/app/chat/utils/coworker-utils";
import { getSession } from "@/lib/auth/auth.server";
import { CoworkerSchema } from "@/lib/clients/generated/core/schemas.gen";
import { coworkerService } from "@/lib/services/coworker.service";

/**
 * GET /api/coworkers
 * Returns the list of coworkers for the authenticated user (from Core API / DB).
 */
const COWORKER_CAPABILITIES = CoworkerSchema.properties.capabilities.items.enum;

function isCoworkerCapability(value: string): value is CoworkerCapability {
  return COWORKER_CAPABILITIES.some((capability) => capability === value);
}

function parseCapability(value: string | null): CoworkerCapability | undefined {
  if (!value) {
    return undefined;
  }

  if (isCoworkerCapability(value)) {
    return value;
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
