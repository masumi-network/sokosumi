import { jobRepository } from "@sokosumi/database/repositories";
import type { NextRequest, NextResponse } from "next/server";
import superJson from "superjson";

import { createApiSuccessResponse, handleApiError } from "@/lib/api";
import {
  canReadJobInActiveWorkspace,
  getJobWorkspaceContext,
} from "@/lib/auth/job-access";
import { getSession } from "@/lib/auth/utils";
import prisma from "@/lib/db/prisma";

interface RouteParams {
  params: Promise<{
    jobId: string;
  }>;
}

/**
 * Get job by ID internally
 * @description Retrieves a specific job by ID for the active personal or organization context
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

    const job = await jobRepository.getJobById(jobId, prisma);
    const canReadJob =
      !!job &&
      (await canReadJobInActiveWorkspace(
        job,
        getJobWorkspaceContext(session),
        prisma,
      ));

    if (!canReadJob) {
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
