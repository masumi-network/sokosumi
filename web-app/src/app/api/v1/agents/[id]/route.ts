import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import { API_ERROR_CODES } from "@/lib/api/v1/types";
import {
  ApiErrorClass,
  createApiResponse,
  requireAuth,
} from "@/lib/api/v1/utils";
import { getAvailableAgentById } from "@/lib/services/agent";

async function getAgentById(
  request: NextRequest,
  context: { params: { id: string } },
): Promise<NextResponse> {
  await requireAuth();

  const agentId = context.params.id;
  if (!agentId) {
    throw new ApiErrorClass(
      API_ERROR_CODES.BAD_REQUEST,
      "Agent ID is required",
      400,
    );
  }

  const agent = await getAvailableAgentById(agentId);

  if (!agent) {
    throw new ApiErrorClass(
      API_ERROR_CODES.NOT_FOUND,
      "Agent not found or not accessible",
      404,
    );
  }

  return NextResponse.json(createApiResponse(agent));
}

export const GET = createApiRoute(getAgentById);
