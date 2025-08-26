import { NextRequest } from "next/server";

import {
  createApiSuccessResponse,
  formatAgentResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";
import { agentService } from "@/lib/services";

/**
 * List agents
 * @description Retrieves all available agents with credit pricing
 * @response AgentsSuccessResponse
 * @responseSet public
 * @tag Agents
 * @auth apikey
 * @openapi
 */
export async function GET(request: NextRequest) {
  try {
    const _apiKey = await validateApiKey(request.headers);

    // Get all available agents with credits pricing
    const agents = await agentService.getAvailableAgentsWithCreditsPrice();

    // Format agents to handle BigInt and Date serialization
    const formattedAgents = agents.map(formatAgentResponse);

    return createApiSuccessResponse(formattedAgents);
  } catch (error) {
    return handleApiError(error, "retrieve agents");
  }
}
