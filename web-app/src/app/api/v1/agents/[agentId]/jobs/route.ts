import { NextRequest, NextResponse } from "next/server";

import {
  CommonErrorCode,
  JobErrorCode,
  startJobWithInputData,
} from "@/lib/actions";
import {
  createJobRequestSchema,
  formatJobResponse,
  handleApiError,
  validateApiKeySession,
} from "@/lib/api";
import { agentClient } from "@/lib/clients";
import { convertCreditsToCents } from "@/lib/db";
import { jobRepository } from "@/lib/db/repositories";
import { agentService } from "@/lib/services";

interface RouteParams {
  params: Promise<{
    agentId: string;
  }>;
}

/**
 * GET /api/v1/agents/:agentId/jobs
 * Retrieves all jobs for a specific agent that belong to the authenticated user
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await validateApiKeySession(request.headers);
    const { agentId } = await params;

    // Validate that the agent exists and is available
    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      return NextResponse.json(
        {
          error: "Not Found",
          message: "Agent not found or not available",
        },
        { status: 404 },
      );
    }

    const jobs = await jobRepository.getPersonalJobsByAgentIdAndUserId(
      agentId,
      session.user.id,
    );

    // Format all jobs
    const formattedJobs = jobs.map((job) => formatJobResponse(job).job);

    return NextResponse.json({
      jobs: formattedJobs,
      total: formattedJobs.length,
    });
  } catch (error) {
    return handleApiError(error, "retrieve jobs");
  }
}

/**
 * POST /api/v1/agents/:agentId/jobs
 * Creates a new job for a specific agent
 */
export async function POST(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    await validateApiKeySession(request.headers);
    const { agentId } = await params;

    // Parse request body
    const body = await request.json();
    const validatedData = createJobRequestSchema.parse(body);

    // Validate that the agent exists and is available
    const agent = await agentService.getAvailableAgentById(agentId);
    if (!agent) {
      return NextResponse.json(
        {
          error: "Not Found",
          message: "Agent not found or not available",
        },
        { status: 404 },
      );
    }

    // Get the agent's input schema from the agent API
    const inputSchemaResult = await agentClient.fetchAgentInputSchema(agent);
    if (!inputSchemaResult.ok) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message:
            "Failed to fetch agent input schema: " + inputSchemaResult.error,
        },
        { status: 400 },
      );
    }
    const agentInputSchema = inputSchemaResult.data.input_data;

    // Convert credits back to cents for the job service
    const maxAcceptedCents = convertCreditsToCents(
      validatedData.maxAcceptedCredits,
    );

    // Convert inputData to Map format expected by the service
    const inputDataMap = new Map(Object.entries(validatedData.inputData ?? {}));

    // Create the job using the existing action
    const result = await startJobWithInputData({
      agentId,
      maxAcceptedCents,
      inputSchema: agentInputSchema,
      inputData: inputDataMap,
    });

    if (!result.ok) {
      // Handle specific job creation errors
      switch (result.error.code) {
        case CommonErrorCode.BAD_INPUT:
          return NextResponse.json(
            {
              error: "Bad Request",
              message: result.error.message,
            },
            { status: 400 },
          );
        case JobErrorCode.AGENT_NOT_FOUND:
          return NextResponse.json(
            {
              error: "Not Found",
              message: result.error.message,
            },
            { status: 404 },
          );
        case JobErrorCode.INSUFFICIENT_BALANCE:
          return NextResponse.json(
            {
              error: "Payment Required",
              message: result.error.message,
            },
            { status: 402 },
          );
        case JobErrorCode.COST_TOO_HIGH:
          return NextResponse.json(
            {
              error: "Bad Request",
              message: result.error.message,
            },
            { status: 400 },
          );
        default:
          return NextResponse.json(
            {
              error: "Internal Server Error",
              message: result.error.message,
            },
            { status: 500 },
          );
      }
    }

    // Get the created job and return it
    const createdJob = await jobRepository.getJobById(result.data.jobId);
    if (!createdJob) {
      return NextResponse.json(
        {
          error: "Internal Server Error",
          message: "Failed to retrieve created job",
        },
        { status: 500 },
      );
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
        return NextResponse.json(formatJobResponse(updatedJob), {
          status: 201,
        });
      }
    }

    return NextResponse.json(formatJobResponse(createdJob), { status: 201 });
  } catch (error) {
    // Handle Zod validation errors specifically
    if (error && typeof error === "object" && "issues" in error) {
      return NextResponse.json(
        {
          error: "Bad Request",
          message: "Invalid request data",
          details: (error as { issues: unknown[] }).issues,
        },
        { status: 400 },
      );
    }

    return handleApiError(error, "create job");
  }
}
