import { NextRequest, NextResponse } from "next/server";

import {
  createApiSuccessResponse,
  formatJobResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";
import { jobRepository } from "@/lib/db/repositories";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Get job by ID
 * @description Retrieves a specific job by ID belonging to the authenticated user
 * @pathParams JobParams
 * @response JobSuccessResponse
 * @responseSet public
 * @tag Jobs
 * @auth apikey
 * @openapi
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { userId, metadata } = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Get organization context from API key
    const activeOrganizationId: string | null =
      metadata?.organizationId ?? null;

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      userId,
      activeOrganizationId,
    );

    if (!job) {
      throw new Error("JOB_NOT_FOUND");
    }

    // Format and return the job
    return createApiSuccessResponse(formatJobResponse(job));
  } catch (error) {
    return handleApiError(error, "retrieve job", {
      path: request.nextUrl.pathname,
    });
  }
}
