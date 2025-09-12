import { NextRequest, NextResponse } from "next/server";

import { createApiSuccessResponse, handleApiError } from "@/lib/api";
import { agentClient } from "@/lib/clients/agent.client";
import { agentRepository } from "@/lib/db/repositories";
import { jobInputsDataSchema } from "@/lib/job-input";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * Get agent input schema
 * @description Fetches the validated input schema for a specific agent
 * @pathParams AgentParams
 * @response AgentInputSchemaSuccessResponse
 * @responseSet public
 * @auth apikey
 * @tag Agents
 * @openapi
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { agentId } = await params;
    if (!agentId) {
      throw new Error("INVALID_INPUT");
    }

    const agent = await agentRepository.getAgentWithRelationsById(agentId);
    if (!agent) {
      throw new Error("AGENT_NOT_FOUND");
    }

    const inputSchemaResult = await agentClient.fetchAgentInputSchema(agent);
    if (!inputSchemaResult.ok) {
      throw new Error(inputSchemaResult.error);
    }

    const inputSchema = jobInputsDataSchema().parse(inputSchemaResult.data);
    console.log(inputSchema);

    const debugInputSchema = {
      input_data: [
        {
          id: "blob",
          type: "file",
          name: "blob",
          data: {
            description: "Select either Image or Video",
          },
          validations: [
            { validation: "min", value: "1" },
            { validation: "max", value: "1" },
            { validation: "accept", value: "image/*" },
            { validation: "maxSize", value: "1000000" },
          ],
        },
        {
          id: "mediaType",
          type: "option",
          name: "mediaType",
          data: {
            values: ["image", "video"],
            description: "Select either Image or Video",
          },
          validations: [
            { validation: "min", value: "1" },
            { validation: "max", value: "1" },
          ],
        },
      ],
    };
    console.log(debugInputSchema);
    return createApiSuccessResponse(debugInputSchema);
  } catch (error) {
    return handleApiError(error, "retrieve agent input schema", {
      path: request.nextUrl.pathname,
    });
  }
}
