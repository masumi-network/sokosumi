import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth/auth.server";
import { loadSkillsMarketplaceData } from "@/lib/hermes/skills-marketplace-data";

/**
 * GET /api/personal-assistant/skills-marketplace
 *
 * Same payload as `getSkillsMarketplaceAction`, but served as a normal fetch
 * so the wizard pre-warm (and dialog open) does not occupy Next's serialized
 * server-action queue — Integrations OAuth and other wizard actions stay free.
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
    const data = await loadSkillsMarketplaceData();
    return NextResponse.json({ data });
  } catch (error) {
    console.error("Failed to load skills marketplace:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to load skills marketplace",
      },
      { status: 500 },
    );
  }
}
