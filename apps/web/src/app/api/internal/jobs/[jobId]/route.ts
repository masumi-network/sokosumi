import type { NextRequest, NextResponse } from "next/server";
import superJson from "superjson";

import { mapCoreJobToJobWithSokosumiStatus } from "@/lib/agents/core-dto-mappers";
import { createApiSuccessResponse, handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth/utils";
import { CoreApiRequestError, coreClient } from "@/lib/clients/core.client";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Get job by ID internally
 * @description Retrieves a specific job by ID readable by the authenticated user
 */
export async function GET(
  request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) {
      throw new Error("UNAUTHORIZED");
    }
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    let job;
    try {
      const response = await coreClient.getJobById(jobId);
      job = mapCoreJobToJobWithSokosumiStatus(response.data);
    } catch (error) {
      if (error instanceof CoreApiRequestError) {
        if (error.status === 401) {
          throw new Error("UNAUTHORIZED");
        }
        if (error.status === 403 || error.status === 404) {
          throw new Error("JOB_NOT_FOUND");
        }
      }
      throw error;
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
