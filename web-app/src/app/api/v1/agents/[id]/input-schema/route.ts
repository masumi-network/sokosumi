import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createApiResponse,
  requireAuth,
} from "@/lib/api/v1/utils";
import {
  getAgentInputSchema,
  getAvailableAgentById,
} from "@/lib/services/agent";

interface RouteParams {
  id: string;
}

interface RouteContext {
  params: Promise<RouteParams>;
}

async function getAgentInputSchemaById(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  await requireAuth();

  const { id: agentId } = await context.params;
  if (!agentId) {
    throw new ApiErrorClass(
      API_ERROR_CODES.BAD_REQUEST,
      "Agent ID is required",
      400,
    );
  }

  // Check if the agent is available to the user
  const agent = await getAvailableAgentById(agentId);
  if (!agent) {
    throw new ApiErrorClass(
      API_ERROR_CODES.NOT_FOUND,
      "Agent not found or not accessible",
      404,
    );
  }

  try {
    const inputSchema = await getAgentInputSchema(agentId);
    return NextResponse.json(createApiResponse(inputSchema));
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to get agent input schema";
    throw new ApiErrorClass(API_ERROR_CODES.INTERNAL_ERROR, message, 500);
  }
}

export const GET = createApiRoute(getAgentInputSchemaById);
