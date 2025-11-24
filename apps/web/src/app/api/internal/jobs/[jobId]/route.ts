import { jobRepository } from "@sokosumi/database/repositories";
import { NextRequest, NextResponse } from "next/server";
import superJson from "superjson";

import {
  createApiSuccessResponse,
  handleApiError,
  validateAuth,
} from "@/lib/api";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Get job by ID internally
 * @description Retrieves a specific job by ID belonging to the authenticated user
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { authContext } = await validateAuth(request.headers);
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    // Get the job with authorization check
    const job = await jobRepository.getJobByIdWithAuthCheck(
      jobId,
      authContext.userId,
      authContext.organizationId,
    );

    if (!job) {
      throw new Error("JOB_NOT_FOUND");
    }

    // Format and return the job
    const stringifiedJob = superJson.stringify(job);
    return createApiSuccessResponse(stringifiedJob);
  } catch (error) {
    return handleApiError(error, "retrieve job", {
      path: request.nextUrl.pathname,
    });
  }
}
