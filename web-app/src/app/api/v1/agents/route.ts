import { NextRequest, NextResponse } from "next/server";

import { formatAgentResponse, handleApiError, validateApiKey } from "@/lib/api";
import { agentService } from "@/lib/services";

export async function GET(request: NextRequest) {
  try {
    const _apiKey = await validateApiKey(request.headers);

    // Get all available agents with credits pricing
    const agents = await agentService.getAvailableAgentsWithCreditsPrice();

    // Format agents to handle BigInt and Date serialization
    const formattedAgents = agents.map(formatAgentResponse);

    return NextResponse.json({
      agents: formattedAgents,
      total: formattedAgents.length,
    });
  } catch (error) {
    return handleApiError(error, "retrieve agents");
  }
}
