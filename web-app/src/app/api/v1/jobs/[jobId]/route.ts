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
 * GET /api/v1/jobs/:jobId
 * Retrieves a specific job by ID that belongs to the authenticated user
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const apiKey = await validateApiKey(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Get organization context from API key
    const activeOrganizationId = apiKey.metadata?.organizationId ?? null;

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      apiKey.userId,
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
