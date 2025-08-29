import { NextRequest, NextResponse } from "next/server";

import { CommonErrorCode, JobErrorCode, startJob } from "@/lib/actions";
import {
  createApiSuccessResponse,
  createJobRequestSchema,
  formatJobResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";
import { convertCreditsToCents } from "@/lib/db";
import { jobRepository } from "@/lib/db/repositories";
import { jobInputsDataSchema } from "@/lib/job-input";
import { agentService } from "@/lib/services";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * List jobs for agent
 * @description Retrieves all jobs for the given agent belonging to the authenticated user
 * @pathParams AgentParams
 * @response JobsSuccessResponse
 * @responseSet public
 * @tag Agents
 * @auth apikey
 * @openapi
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const apiKey = await validateApiKey(request.headers);
    const { agentId } = await params;

    // Validate that the agent exists and is available
    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      throw new Error("AGENT_NOT_FOUND");
    }

    // Get organization context from session (works for both regular sessions and API keys)
    const activeOrganizationId = apiKey.metadata?.organizationId;

    const jobs = await jobRepository.getJobs({
      agentId,
      userId: apiKey.userId,
      organizationId: activeOrganizationId,
    });

    // Format all jobs
    const formattedJobs = jobs.map((job) => formatJobResponse(job));
    return createApiSuccessResponse(formattedJobs);
  } catch (error) {
    return handleApiError(error, "retrieve jobs");
  }
}

/**
 * Create job for agent
 * @description Creates a new job for a specific agent with validated input data
 * @pathParams AgentParams
 * @body CreateJobBody
 * @response JobSuccessResponse
 * @responseSet public
 * @tag Agents
 * @auth apikey
 * @openapi
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const apiKey = await validateApiKey(request.headers);
    const { agentId } = await params;

    // Parse request body
    const body = await request.json();
    const validatedData = createJobRequestSchema.parse(body);

    const baseUrl = request.nextUrl.origin;
    const response = await fetch(
      `${baseUrl}/api/v1/agents/${encodeURIComponent(agentId)}/input-schema`,
    );

    if (!response.ok) {
      throw new Error("INVALID_INPUT");
    }

    const inputSchema = await response.json();
    const validatedInputSchema = jobInputsDataSchema().parse(inputSchema.data);

    // Convert credits back to cents for the job service
    const maxAcceptedCents = convertCreditsToCents(
      validatedData.maxAcceptedCredits,
    );

    // Convert inputData to Map format expected by the service
    const inputDataMap = new Map(Object.entries(validatedData.inputData ?? {}));

    // Create the job using the existing action
    const result = await startJob({
      input: {
        agentId,
        maxAcceptedCents,
        inputSchema: validatedInputSchema.input_data,
        inputData: inputDataMap,
      },
      authContext: {
        userId: apiKey.userId,
        organizationId: apiKey.metadata?.organizationId ?? null,
      },
    });

    if (!result.ok) {
      // Handle specific job creation errors by throwing errors that handleApiError can catch
      switch (result.error.code) {
        case CommonErrorCode.BAD_INPUT:
          throw new Error("INVALID_INPUT");
        case JobErrorCode.AGENT_NOT_FOUND:
          throw new Error("AGENT_NOT_FOUND");
        case JobErrorCode.INSUFFICIENT_BALANCE:
          throw new Error("INSUFFICIENT_BALANCE");
        case JobErrorCode.COST_TOO_HIGH:
          throw new Error("INVALID_INPUT");
        default:
          throw new Error(result.error.message ?? "Unknown error");
      }
    }

    // Get the created job and return it
    const createdJob = await jobRepository.getJobById(result.data.jobId);
    if (!createdJob) {
      throw new Error("JOB_NOT_FOUND");
    }

    // Set the job name if provided
    if (validatedData.name && validatedData.name.trim()) {
      await jobRepository.updateJobNameById(
        createdJob.id,
        validatedData.name.trim(),
      );
      // Refetch the job with updated name
      const updatedJob = await jobRepository.getJobById(result.data.jobId);
      if (updatedJob) {
        return createApiSuccessResponse(formatJobResponse(updatedJob), {
          status: 201,
        });
      }
    }

    return createApiSuccessResponse(formatJobResponse(createdJob), {
      status: 201,
    });
  } catch (error) {
    return handleApiError(error, "create job");
  }
}
