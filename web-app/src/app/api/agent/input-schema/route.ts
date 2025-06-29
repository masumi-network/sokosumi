import { NextRequest, NextResponse } from "next/server";

import { getAgentInputSchema } from "@/lib/services";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json(
      { message: "Agent ID is required" },
      { status: 400 },
    );
  }

  try {
    const inputSchema = await getAgentInputSchema(agentId);
    return NextResponse.json(inputSchema);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { message: message || "Failed to get agent input schema" },
      { status: 500 },
    );
  }
}
