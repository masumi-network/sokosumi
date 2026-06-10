import type { NextRequest, NextResponse } from "next/server";
import superJson from "superjson";

import { createApiSuccessResponse, handleApiError } from "@/lib/api";
import { getSession } from "@/lib/auth/utils";
import { coreClient } from "@/lib/clients/core.client";

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
    const session = await getSession();
    if (!session) {
      throw new Error("UNAUTHORIZED");
    }
    const { jobId } = await params;

    if (!jobId) {
      throw new Error("INVALID_INPUT");
    }

    const { data: job } = await coreClient.getJobById(jobId);

    if (!job || job.userId !== session.user.id) {
      throw new Error("JOB_NOT_FOUND");
    }

    const stringifiedJob = superJson.stringify(job);
    return createApiSuccessResponse(stringifiedJob);
  } catch (error) {
    return handleApiError(error, "retrieve job", {
      path: request.nextUrl.pathname,
    });
  }
}
