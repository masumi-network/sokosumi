import { NextRequest, NextResponse } from "next/server";

import { agentClient } from "@/lib/clients/agent.client";
import { agentRepository } from "@/lib/db/repositories";

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json(
      { message: "Agent ID is required" },
      { status: 400 },
    );
  }

  try {
    const agent = await agentRepository.getAgentWithRelationsById(agentId);
    if (!agent) {
      throw new Error(`Agent with ID ${agentId} not found`);
    }
    const inputSchemaResult = await agentClient.fetchAgentInputSchema(agent);
    if (!inputSchemaResult.ok) {
      throw new Error(inputSchemaResult.error);
    }
    return NextResponse.json(inputSchemaResult.data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { message: message || "Failed to get agent input schema" },
      { status: 500 },
    );
  }
}
