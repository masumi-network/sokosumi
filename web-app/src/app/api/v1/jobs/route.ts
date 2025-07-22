import { NextRequest, NextResponse } from "next/server";

import { createApiRoute } from "@/lib/api/v1/middleware";
import {
  createApiResponse,
  createPaginatedResponse,
  extractPaginationParams,
  requireAuth,
  validateParams,
} from "@/lib/api/v1/utils";
import {
  retrieveJobByIdUserIdAndOrganizationId,
  retrieveJobsByIds,
} from "@/lib/db/repositories/job";
import { startJob } from "@/lib/services/job";

async function createJobHandler(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  const body = await request.json();
  const jobData = validateParams(CreateJobSchema, body);

  const { id: jobId } = await startJob({
    userId: session.user.id,
    agentId: jobData.agentId,
    inputData: new Map(Object.entries(jobData.inputData)),
    inputSchema: jobData.inputSchema,
    maxAcceptedCents: BigInt(jobData.maxAcceptedCents),
  });

  // Get the job with relations to return full response
  const job = await retrieveJobByIdUserIdAndOrganizationId(
    jobId,
    session.user.id,
    null,
  );

  if (!job) {
    throw new Error("Failed to retrieve created job");
  }

  return NextResponse.json(createApiResponse(job), { status: 201 });
}

async function getJobsHandler(request: NextRequest): Promise<NextResponse> {
  const session = await requireAuth();
  const paginationParams = extractPaginationParams(request);

  // Get all user jobs
  const jobs = await retrieveJobsByIds(
    session.user.id,
    session.session.activeOrganizationId ?? null,
  );

  // Apply pagination
  const total = jobs.length;
  const startIndex = (paginationParams.page! - 1) * paginationParams.limit!;
  const endIndex = startIndex + paginationParams.limit!;
  const paginatedJobs = jobs.slice(startIndex, endIndex);

  return NextResponse.json(
    createPaginatedResponse(paginatedJobs, {
      page: paginationParams.page!,
      limit: paginationParams.limit!,
      total,
    }),
  );
}

export const POST = createApiRoute(createJobHandler);
export const GET = createApiRoute(getJobsHandler);
