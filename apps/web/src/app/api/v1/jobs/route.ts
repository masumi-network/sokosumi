import { SokosumiJobStatus } from "@sokosumi/database";
import { jobRepository } from "@sokosumi/database/repositories";
import { NextRequest, NextResponse } from "next/server";

import {
  createApiSuccessResponse,
  formatJobResponse,
  handleApiError,
  validateApiKey,
} from "@/lib/api";

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
    const statusFilter = searchParams.get("status") as SokosumiJobStatus | null;

    // Get organization context from API key
    const activeOrganizationId = apiKey.metadata?.organizationId;

    const jobs = await jobRepository.getJobs({
      OR: [
        ...(activeOrganizationId
          ? [{ share: { organizationId: activeOrganizationId } }]
          : []),
        { userId: apiKey.userId },
      ],
      ...(agentIdFilter ? { agentId: agentIdFilter } : {}),
    });

    // Apply filters
    let filteredJobs = jobs;

    if (
      statusFilter &&
      Object.values(SokosumiJobStatus).includes(statusFilter)
    ) {
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
