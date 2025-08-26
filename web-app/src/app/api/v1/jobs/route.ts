import { NextRequest, NextResponse } from "next/server";

import {
  createApiSuccessResponse,
  formatJobResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";
import { jobRepository } from "@/lib/db/repositories";
import { JobStatus } from "@/lib/db/types";

/**
 * List jobs
 * @description Retrieves all jobs that belong to the authenticated user. Supports optional query parameters for filtering:
 * - agentId: Filter by specific agent ID
 * - status: Filter by job status (completed, processing, etc.)
 * @params JobQueryParams
 * @response JobsSuccessResponse
 * @responseSet public
 * @tag Jobs
 * @auth apikey
 * @openapi
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const apiKey = await validateApiKey(request.headers);

    // Parse query parameters
    const { searchParams } = request.nextUrl;
    const agentIdFilter = searchParams.get("agentId");
    const statusFilter = searchParams.get("status") as JobStatus | null;

    // Get organization context from API key
    const activeOrganizationId = apiKey.metadata?.organizationId;

    const jobs = await jobRepository.getJobs({
      userId: apiKey.userId,
      organizationId: activeOrganizationId,
      ...(agentIdFilter ? { agentId: agentIdFilter } : {}),
    });

    // Apply filters
    let filteredJobs = jobs;

    if (statusFilter && Object.values(JobStatus).includes(statusFilter)) {
      filteredJobs = filteredJobs.filter((job) => job.status === statusFilter);
    }

    // Format all jobs
    const formattedJobs = filteredJobs.map((job) => formatJobResponse(job));

    return createApiSuccessResponse(formattedJobs);
  } catch (error) {
    return handleApiError(error, "retrieve jobs", {
      path: request.nextUrl.pathname,
    });
  }
}
