import { NextRequest, NextResponse } from "next/server";

import { agentClient } from "@/lib/clients/agent.client";
import { agentRepository } from "@/lib/db/repositories";
import { jobInputsDataSchema } from "@/lib/job-input";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  const { agentId } = await params;
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

    const inputSchema = jobInputsDataSchema().parse(inputSchemaResult.data);
    return NextResponse.json(inputSchema);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return NextResponse.json(
      { message: message || "Failed to get agent input schema" },
      { status: 500 },
    );
  }
}
