import { APIError } from "better-auth/api";
import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth/auth";
import { AgentWithCreditsPrice, convertCentsToCredits } from "@/lib/db";
import { AgentResponse } from "@/lib/schemas";
import { agentService } from "@/lib/services";

async function validateSession(headers: Headers) {
  const session = await auth.api.getSession({ headers });

  if (!session) {
    throw new Error("UNAUTHORIZED");
  }

  return session;
}

// Helper function to format agent response with BigInt conversion
function formatAgentResponse(agent: AgentWithCreditsPrice): AgentResponse {
  return {
    id: agent.id,
    createdAt: agent.createdAt.toISOString(),
    updatedAt: agent.updatedAt.toISOString(),
    name: agent.name,
    description: agent.description,
    status: agent.status,
    isNew: agent.isNew,
    isShown: agent.isShown,
    creditsPrice: {
      credits: convertCentsToCredits(agent.creditsPrice.cents),
      includedFee: convertCentsToCredits(agent.creditsPrice.includedFee),
    },
    tags: agent.tags.map((tag) => ({
      name: tag.name,
    })),
  };
}

// Helper function for common error handling
function handleApiError(error: unknown, operation: string): NextResponse {
  console.error(`Error in ${operation}:`, error);

  if (error instanceof APIError) {
    return NextResponse.json(
      { error: "Unauthorized", message: error.message || "Invalid API key" },
      { status: 401 },
    );
  }

  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json(
      { error: "Unauthorized", message: "Valid API key required" },
      { status: 401 },
    );
  }

  return NextResponse.json(
    {
      error: "Internal Server Error",
      message: `Failed to ${operation}`,
    },
    { status: 500 },
  );
}

export async function GET(request: NextRequest) {
  try {
    await validateSession(request.headers);

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
