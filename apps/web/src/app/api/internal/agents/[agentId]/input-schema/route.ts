import { inputSchemaSchema } from "@sokosumi/masumi/schemas";
import { NextRequest, NextResponse } from "next/server";

import { createApiSuccessResponse, handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      throw new Error("UNAUTHORIZED");
    }

    const { agentId } = await params;
    if (!agentId) {
      throw new Error("INVALID_INPUT");
    }

    const response = await coreClient.getAgentInputSchema(agentId);
    const inputSchema = inputSchemaSchema.parse(response.data);

    return createApiSuccessResponse(inputSchema);
  } catch (error) {
    return handleApiError(error, "retrieve agent input schema", {
      path: request.nextUrl.pathname,
    });
  }
}
